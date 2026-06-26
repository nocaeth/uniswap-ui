import { DataApiService } from '@uniswap/client-data-api/dist/data/v1/api_connect.js'
import {
  GetPositionRequest,
  GetPositionResponse,
  ListPositionsRequest,
  ListPositionsResponse,
} from '@uniswap/client-data-api/dist/data/v1/api_pb.js'
import {
  PoolPosition,
  Position,
  PositionStatus,
  ProtocolVersion,
  Token as RestToken,
} from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb.js'
import { Token } from '@uniswap/sdk-core'
import { FeeAmount, Pool, Position as V3Position, TICK_SPACINGS } from '@uniswap/v3-sdk'
import type { ServiceType } from '@bufbuild/protobuf'
import type { ConnectRouter, ServiceImpl } from '@connectrpc/connect'
import { createPublicClient, getAddress, http, type Address, type PublicClient } from 'viem'
import { gnosis } from 'viem/chains'

// Gnosis-only deployment. Uniswap's DataApiService (positions backend) does not
// cover Gnosis, so we serve ListPositions/GetPosition for V3 by reading the
// NonfungiblePositionManager + pools directly from chain on demand.
const GNOSIS_CHAIN_ID = 100

// Confirmed in @uniswap/sdk-core (patched) for chain 100.
const NPM_ADDRESS = getAddress('0xAE8fbE656a77519a7490054274910129c9244FA3')
const FACTORY_ADDRESS = getAddress('0xe32F7dD7e3f098D518ff19A22d5f028e076489B1')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Read from the same node the wallet transacts against. In dev that's the anvil
// fork (POSITIONS_RPC_URL); in a hosted deployment set RPC_GNOSIS (see the adapter
// service in docker-compose.yml). The localhost fallback only applies if none is set.
const RPC_URL =
  process.env.POSITIONS_RPC_URL ??
  process.env.GNOSIS_RPC_URL ??
  process.env.RPC_GNOSIS ??
  'http://localhost:8545'

const client: PublicClient = createPublicClient({ chain: gnosis, transport: http(RPC_URL) })

const Q128 = 1n << 128n
const MAX_UINT256 = (1n << 256n) - 1n

const NPM_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
  },
] as const

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }],
    outputs: [{ type: 'address' }],
  },
] as const

const POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'feeGrowthGlobal0X128', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feeGrowthGlobal1X128', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'ticks',
    stateMutability: 'view',
    inputs: [{ type: 'int24' }],
    outputs: [
      { name: 'liquidityGross', type: 'uint128' },
      { name: 'liquidityNet', type: 'int128' },
      { name: 'feeGrowthOutside0X128', type: 'uint256' },
      { name: 'feeGrowthOutside1X128', type: 'uint256' },
      { name: 'tickCumulativeOutside', type: 'int56' },
      { name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
      { name: 'secondsOutside', type: 'uint32' },
      { name: 'initialized', type: 'bool' },
    ],
  },
] as const

const ERC20_ABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

interface RawPosition {
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  liquidity: bigint
  feeGrowthInside0LastX128: bigint
  feeGrowthInside1LastX128: bigint
  tokensOwed0: bigint
  tokensOwed1: bigint
}

interface TokenMeta {
  address: Address
  symbol: string
  name: string
  decimals: number
}

interface PoolState {
  address: Address
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  feeGrowthGlobal0X128: bigint
  feeGrowthGlobal1X128: bigint
}

function sub256(a: bigint, b: bigint): bigint {
  return (a - b) & MAX_UINT256
}

// Live uncollected fees = checkpointed tokensOwed + accrued since last checkpoint.
// Mirrors UniswapV3 Position.update / NFT periphery fee accounting (uint256-wrapping).
function uncollectedFee(args: {
  feeGrowthGlobalX128: bigint
  feeGrowthOutsideLowerX128: bigint
  feeGrowthOutsideUpperX128: bigint
  feeGrowthInsideLastX128: bigint
  tickCurrent: number
  tickLower: number
  tickUpper: number
  liquidity: bigint
  tokensOwed: bigint
}): bigint {
  const { tickCurrent, tickLower, tickUpper, feeGrowthGlobalX128 } = args
  const feeGrowthBelow =
    tickCurrent >= tickLower ? args.feeGrowthOutsideLowerX128 : sub256(feeGrowthGlobalX128, args.feeGrowthOutsideLowerX128)
  const feeGrowthAbove =
    tickCurrent < tickUpper ? args.feeGrowthOutsideUpperX128 : sub256(feeGrowthGlobalX128, args.feeGrowthOutsideUpperX128)
  const feeGrowthInside = sub256(sub256(feeGrowthGlobalX128, feeGrowthBelow), feeGrowthAbove)
  const delta = sub256(feeGrowthInside, args.feeGrowthInsideLastX128)
  return args.tokensOwed + (delta * args.liquidity) / Q128
}

function statusFor(liquidity: bigint, tickCurrent: number, tickLower: number, tickUpper: number): PositionStatus {
  if (liquidity === 0n) {
    return PositionStatus.CLOSED
  }
  return tickCurrent >= tickLower && tickCurrent < tickUpper ? PositionStatus.IN_RANGE : PositionStatus.OUT_OF_RANGE
}

function isStandardFee(fee: number): fee is FeeAmount {
  return fee in TICK_SPACINGS
}

async function fetchTokenIds(owner: Address): Promise<bigint[]> {
  const balance = (await client.readContract({
    address: NPM_ADDRESS,
    abi: NPM_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint
  const count = Number(balance)
  if (count === 0) {
    return []
  }
  const ids = (await client.multicall({
    allowFailure: false,
    contracts: Array.from({ length: count }, (_, i) => ({
      address: NPM_ADDRESS,
      abi: NPM_ABI,
      functionName: 'tokenOfOwnerByIndex',
      args: [owner, BigInt(i)],
    })),
  })) as bigint[]
  return ids
}

async function fetchRawPositions(tokenIds: bigint[]): Promise<Map<string, RawPosition>> {
  const results = (await client.multicall({
    allowFailure: true,
    contracts: tokenIds.map((id) => ({
      address: NPM_ADDRESS,
      abi: NPM_ABI,
      functionName: 'positions',
      args: [id],
    })),
  })) as { status: 'success' | 'failure'; result?: readonly unknown[] }[]

  const map = new Map<string, RawPosition>()
  results.forEach((res, i) => {
    if (res.status !== 'success' || !res.result) {
      return
    }
    const r = res.result as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]
    map.set(tokenIds[i]!.toString(), {
      token0: getAddress(r[2]),
      token1: getAddress(r[3]),
      fee: Number(r[4]),
      tickLower: Number(r[5]),
      tickUpper: Number(r[6]),
      liquidity: r[7],
      feeGrowthInside0LastX128: r[8],
      feeGrowthInside1LastX128: r[9],
      tokensOwed0: r[10],
      tokensOwed1: r[11],
    })
  })
  return map
}

async function fetchTokenMeta(addresses: Address[]): Promise<Map<string, TokenMeta>> {
  const unique = [...new Set(addresses.map((a) => getAddress(a)))]
  const contracts = unique.flatMap((address) => [
    { address, abi: ERC20_ABI, functionName: 'symbol' as const },
    { address, abi: ERC20_ABI, functionName: 'name' as const },
    { address, abi: ERC20_ABI, functionName: 'decimals' as const },
  ])
  const res = (await client.multicall({ allowFailure: true, contracts })) as {
    status: 'success' | 'failure'
    result?: unknown
  }[]
  const map = new Map<string, TokenMeta>()
  unique.forEach((address, i) => {
    const symbol = res[i * 3]
    const name = res[i * 3 + 1]
    const decimals = res[i * 3 + 2]
    map.set(address, {
      address,
      symbol: symbol?.status === 'success' ? (symbol.result as string) : 'UNKNOWN',
      name: name?.status === 'success' ? (name.result as string) : '',
      decimals: decimals?.status === 'success' ? Number(decimals.result) : 18,
    })
  })
  return map
}

async function fetchPoolStates(pools: { token0: Address; token1: Address; fee: number }[]): Promise<Map<string, PoolState>> {
  // Resolve pool addresses for the (token0,token1,fee) tuples.
  const keys = pools.map((p) => `${p.token0}-${p.token1}-${p.fee}`)
  const addrRes = (await client.multicall({
    allowFailure: true,
    contracts: pools.map((p) => ({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [p.token0, p.token1, p.fee],
    })),
  })) as { status: 'success' | 'failure'; result?: Address }[]

  const poolAddresses = new Map<string, Address>()
  addrRes.forEach((r, i) => {
    if (r.status === 'success' && r.result && r.result !== ZERO_ADDRESS) {
      poolAddresses.set(keys[i]!, getAddress(r.result))
    }
  })

  const uniqueAddresses = [...new Set(poolAddresses.values())]
  if (uniqueAddresses.length === 0) {
    return new Map()
  }

  const stateContracts = uniqueAddresses.flatMap((address) => [
    { address, abi: POOL_ABI, functionName: 'slot0' as const },
    { address, abi: POOL_ABI, functionName: 'liquidity' as const },
    { address, abi: POOL_ABI, functionName: 'feeGrowthGlobal0X128' as const },
    { address, abi: POOL_ABI, functionName: 'feeGrowthGlobal1X128' as const },
  ])
  const stateRes = (await client.multicall({ allowFailure: true, contracts: stateContracts })) as {
    status: 'success' | 'failure'
    result?: unknown
  }[]

  const byAddress = new Map<string, PoolState>()
  uniqueAddresses.forEach((address, i) => {
    const slot0 = stateRes[i * 4]
    const liquidity = stateRes[i * 4 + 1]
    const fg0 = stateRes[i * 4 + 2]
    const fg1 = stateRes[i * 4 + 3]
    if (slot0?.status !== 'success' || liquidity?.status !== 'success') {
      return
    }
    const slot = slot0.result as readonly [bigint, number, number, number, number, number, boolean]
    byAddress.set(address, {
      address,
      sqrtPriceX96: slot[0],
      tick: Number(slot[1]),
      liquidity: liquidity.result as bigint,
      feeGrowthGlobal0X128: fg0?.status === 'success' ? (fg0.result as bigint) : 0n,
      feeGrowthGlobal1X128: fg1?.status === 'success' ? (fg1.result as bigint) : 0n,
    })
  })

  // Re-key by the (token0,token1,fee) tuple for the caller.
  const result = new Map<string, PoolState>()
  for (const [key, addr] of poolAddresses) {
    const state = byAddress.get(addr)
    if (state) {
      result.set(key, state)
    }
  }
  return result
}

async function fetchTickFeeGrowth(
  poolAddress: Address,
  tick: number,
): Promise<{ feeGrowthOutside0X128: bigint; feeGrowthOutside1X128: bigint }> {
  const res = (await client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'ticks',
    args: [tick],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]
  return { feeGrowthOutside0X128: res[2], feeGrowthOutside1X128: res[3] }
}

function toRestToken(meta: TokenMeta): RestToken {
  return new RestToken({
    chainId: GNOSIS_CHAIN_ID,
    address: getAddress(meta.address),
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
    isNative: false,
  })
}

async function buildPosition(args: {
  tokenId: string
  owner: Address
  raw: RawPosition
  pool: PoolState
  token0Meta: TokenMeta
  token1Meta: TokenMeta
}): Promise<Position | undefined> {
  const { tokenId, owner, raw, pool, token0Meta, token1Meta } = args
  if (!isStandardFee(raw.fee)) {
    return undefined
  }

  // Tick fee-growth-outside for the position's bounds (one read per tick).
  const [lower, upper] = await Promise.all([
    fetchTickFeeGrowth(pool.address, raw.tickLower),
    fetchTickFeeGrowth(pool.address, raw.tickUpper),
  ])

  const fee0 = uncollectedFee({
    feeGrowthGlobalX128: pool.feeGrowthGlobal0X128,
    feeGrowthOutsideLowerX128: lower.feeGrowthOutside0X128,
    feeGrowthOutsideUpperX128: upper.feeGrowthOutside0X128,
    feeGrowthInsideLastX128: raw.feeGrowthInside0LastX128,
    tickCurrent: pool.tick,
    tickLower: raw.tickLower,
    tickUpper: raw.tickUpper,
    liquidity: raw.liquidity,
    tokensOwed: raw.tokensOwed0,
  })
  const fee1 = uncollectedFee({
    feeGrowthGlobalX128: pool.feeGrowthGlobal1X128,
    feeGrowthOutsideLowerX128: lower.feeGrowthOutside1X128,
    feeGrowthOutsideUpperX128: upper.feeGrowthOutside1X128,
    feeGrowthInsideLastX128: raw.feeGrowthInside1LastX128,
    tickCurrent: pool.tick,
    tickLower: raw.tickLower,
    tickUpper: raw.tickUpper,
    liquidity: raw.liquidity,
    tokensOwed: raw.tokensOwed1,
  })

  const sdkToken0 = new Token(GNOSIS_CHAIN_ID, getAddress(token0Meta.address), token0Meta.decimals)
  const sdkToken1 = new Token(GNOSIS_CHAIN_ID, getAddress(token1Meta.address), token1Meta.decimals)
  const sdkPool = new Pool(
    sdkToken0,
    sdkToken1,
    raw.fee,
    pool.sqrtPriceX96.toString(),
    pool.liquidity.toString(),
    pool.tick,
  )
  const sdkPosition = new V3Position({
    pool: sdkPool,
    liquidity: raw.liquidity.toString(),
    tickLower: raw.tickLower,
    tickUpper: raw.tickUpper,
  })

  const poolPosition = new PoolPosition({
    tokenId,
    tickLower: raw.tickLower.toString(),
    tickUpper: raw.tickUpper.toString(),
    liquidity: raw.liquidity.toString(),
    token0: toRestToken(token0Meta),
    token1: toRestToken(token1Meta),
    feeTier: raw.fee.toString(),
    currentTick: pool.tick.toString(),
    currentPrice: pool.sqrtPriceX96.toString(),
    tickSpacing: TICK_SPACINGS[raw.fee].toString(),
    token0UncollectedFees: fee0.toString(),
    token1UncollectedFees: fee1.toString(),
    amount0: sdkPosition.amount0.quotient.toString(),
    amount1: sdkPosition.amount1.quotient.toString(),
    poolId: getAddress(pool.address),
    isDynamicFee: false,
    currentLiquidity: pool.liquidity.toString(),
    owner: getAddress(owner),
  })

  return new Position({
    chainId: GNOSIS_CHAIN_ID,
    protocolVersion: ProtocolVersion.V3,
    status: statusFor(raw.liquidity, pool.tick, raw.tickLower, raw.tickUpper),
    isHidden: false,
    position: { case: 'v3Position', value: poolPosition },
  })
}

async function buildPositions(owner: Address, tokenIds: bigint[]): Promise<Position[]> {
  if (tokenIds.length === 0) {
    return []
  }
  const rawById = await fetchRawPositions(tokenIds)
  const raws = [...rawById.entries()]

  const [tokenMeta, poolStates] = await Promise.all([
    fetchTokenMeta(raws.flatMap(([, r]) => [r.token0, r.token1])),
    fetchPoolStates(raws.map(([, r]) => ({ token0: r.token0, token1: r.token1, fee: r.fee }))),
  ])

  const built = await Promise.all(
    raws.map(async ([tokenId, raw]) => {
      const pool = poolStates.get(`${raw.token0}-${raw.token1}-${raw.fee}`)
      const token0Meta = tokenMeta.get(getAddress(raw.token0))
      const token1Meta = tokenMeta.get(getAddress(raw.token1))
      if (!pool || !token0Meta || !token1Meta) {
        return undefined
      }
      try {
        return await buildPosition({ tokenId, owner, raw, pool, token0Meta, token1Meta })
      } catch {
        return undefined
      }
    }),
  )
  return built.filter((p): p is Position => p !== undefined)
}

function chainMatches(chainIds: number[]): boolean {
  return chainIds.length === 0 || chainIds.includes(GNOSIS_CHAIN_ID)
}

function versionMatches(versions: ProtocolVersion[]): boolean {
  return versions.length === 0 || versions.includes(ProtocolVersion.V3)
}

async function listPositions(req: ListPositionsRequest): Promise<ListPositionsResponse> {
  if (!req.address || !chainMatches(req.chainIds) || !versionMatches(req.protocolVersions)) {
    return new ListPositionsResponse({ positions: [] })
  }

  let owner: Address
  try {
    owner = getAddress(req.address)
  } catch {
    return new ListPositionsResponse({ positions: [] })
  }

  const tokenIds = await fetchTokenIds(owner)
  let positions = await buildPositions(owner, tokenIds)

  if (req.positionStatuses.length > 0) {
    positions = positions.filter((p) => req.positionStatuses.includes(p.status))
  }

  // Newest first (NFT ids are monotonically minted).
  positions.sort((a, b) => {
    const aId = BigInt(a.position.case === 'v3Position' ? a.position.value.tokenId : '0')
    const bId = BigInt(b.position.case === 'v3Position' ? b.position.value.tokenId : '0')
    return aId < bId ? 1 : aId > bId ? -1 : 0
  })

  const pageSize = req.pageSize && req.pageSize > 0 ? req.pageSize : positions.length || 1
  const offset = req.pageToken ? Number(req.pageToken) || 0 : 0
  const page = positions.slice(offset, offset + pageSize)
  const nextOffset = offset + pageSize
  const nextPageToken = nextOffset < positions.length ? String(nextOffset) : undefined

  return new ListPositionsResponse({ positions: page, nextPageToken })
}

async function getPosition(req: GetPositionRequest): Promise<GetPositionResponse> {
  if (req.protocolVersion !== ProtocolVersion.V3 || !req.tokenId) {
    return new GetPositionResponse({})
  }
  let tokenId: bigint
  try {
    tokenId = BigInt(req.tokenId)
  } catch {
    return new GetPositionResponse({})
  }

  let owner: Address
  try {
    owner = req.owner
      ? getAddress(req.owner)
      : getAddress(
          (await client.readContract({ address: NPM_ADDRESS, abi: NPM_ABI, functionName: 'ownerOf', args: [tokenId] })) as Address,
        )
  } catch {
    return new GetPositionResponse({})
  }

  const positions = await buildPositions(owner, [tokenId])
  return new GetPositionResponse({ position: positions[0] })
}

// @uniswap/client-data-api ships CJS-compiled type decls; under NodeNext the
// DataApiService value carries @bufbuild/protobuf types resolved in CJS mode,
// which TS treats as distinct from connect's ESM-mode view. Cast through
// ServiceType to bridge the dual resolution-mode views (runtime types identical),
// mirroring exploreService.ts. Only ListPositions/GetPosition are implemented;
// every other DataApiService method stays Unimplemented (connect handles that).
const Service = DataApiService as unknown as ServiceType

export function registerDataApiRoutes(router: ConnectRouter): void {
  router.service(Service, {
    listPositions,
    getPosition,
  } as unknown as ServiceImpl<ServiceType>)
}
