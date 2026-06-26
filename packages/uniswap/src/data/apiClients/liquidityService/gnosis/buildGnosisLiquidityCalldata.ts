import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { TransactionRequest } from '@uniswap/client-liquidity/dist/uniswap/liquidity/v1/types_pb'
import {
  ClaimFeesRequest,
  ClaimFeesResponse,
  CreatePositionRequest,
  CreatePositionResponse,
  DecreasePositionRequest,
  DecreasePositionResponse,
  IncreasePositionRequest,
  IncreasePositionResponse,
  LPApprovalRequest,
  LPApprovalResponse,
} from '@uniswap/client-liquidity/dist/uniswap/liquidity/v2/api_pb'
import {
  ApprovalTransactionRequest,
  LPAction,
  LPToken,
} from '@uniswap/client-liquidity/dist/uniswap/liquidity/v2/types_pb'
import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import { type AddLiquidityOptions, NonfungiblePositionManager, Pool, Position, TickMath } from '@uniswap/v3-sdk'
import JSBI from 'jsbi'
import { nativeOnChain } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'

/**
 * Client-side NonfungiblePositionManager (NPM) calldata for Gnosis V3 liquidity.
 *
 * Uniswap's hosted LiquidityService does not serve Gnosis (100), so for chain 100
 * we build the create/increase/decrease/collect transactions and ERC20 approvals
 * directly from on-chain state (mirroring the client-side swap router). The proto
 * Request/Response shapes are kept identical so the existing tx-flow/saga pipeline
 * consumes them unchanged. V3 LP approval is a plain ERC20.approve to the NPM.
 */

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Confirmed in @uniswap/sdk-core (patched) for chain 100.
const NPM_ADDRESS = '0xAE8fbE656a77519a7490054274910129c9244FA3'
const FACTORY_ADDRESS = '0xe32F7dD7e3f098D518ff19A22d5f028e076489B1'
const WXDAI_ADDRESS = '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'

const DEFAULT_SLIPPAGE_PCT = 0.5
const DEFAULT_DEADLINE_SECS = 60 * 20

const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
]

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)']

const NPM_READ_ABI = [
  'function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
]

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function allowance(address,address) view returns (uint256)',
]

const ERC20_INTERFACE = new Interface(['function approve(address spender, uint256 amount) returns (bool)'])

// Typed views over the dynamically-typed ethers v5 Contract instances (mirrors
// gnosisRouter/fetchGnosisQuote.ts — required by noPropertyAccessFromIndexSignature).
interface PoolContract {
  token0: () => Promise<string>
  token1: () => Promise<string>
  fee: () => Promise<number>
  liquidity: () => Promise<BigNumber>
  slot0: () => Promise<{ sqrtPriceX96: BigNumber; tick: number }>
  feeGrowthGlobal0X128: () => Promise<BigNumber>
  feeGrowthGlobal1X128: () => Promise<BigNumber>
  ticks: (tick: number) => Promise<{ feeGrowthOutside0X128: BigNumber; feeGrowthOutside1X128: BigNumber }>
}
interface FactoryContract {
  getPool: (token0: string, token1: string, fee: number) => Promise<string>
}
interface NpmReadContract {
  positions: (tokenId: BigNumber) => Promise<{
    token0: string
    token1: string
    fee: number
    tickLower: number
    tickUpper: number
    liquidity: BigNumber
    feeGrowthInside0LastX128: BigNumber
    feeGrowthInside1LastX128: BigNumber
    tokensOwed0: BigNumber
    tokensOwed1: BigNumber
  }>
}
interface Erc20Contract {
  decimals: () => Promise<number>
  allowance: (owner: string, spender: string) => Promise<BigNumber>
}

function poolContract(address: string): PoolContract {
  return new Contract(address, POOL_ABI, getGnosisProvider()) as unknown as PoolContract
}
function factoryContract(): FactoryContract {
  return new Contract(FACTORY_ADDRESS, FACTORY_ABI, getGnosisProvider()) as unknown as FactoryContract
}
function npmReadContract(): NpmReadContract {
  return new Contract(NPM_ADDRESS, NPM_READ_ABI, getGnosisProvider()) as unknown as NpmReadContract
}
function erc20Contract(address: string): Erc20Contract {
  return new Contract(address, ERC20_ABI, getGnosisProvider()) as unknown as Erc20Contract
}

const Q128 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(128))
const MAX_UINT256 = JSBI.subtract(JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(256)), JSBI.BigInt(1))

export function isGnosisLiquidityChain(chainId: number | undefined): boolean {
  return chainId === GNOSIS_CHAIN_ID
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function isNativeAddress(address: string): boolean {
  return eqAddr(address, ZERO_ADDRESS)
}

/** Native xDAI (zero address) shares pool state with WXDAI. */
function toPoolTokenAddress(address: string): string {
  return isNativeAddress(address) ? WXDAI_ADDRESS : address
}

function toPercent(slippage?: number): Percent {
  const pct = slippage && slippage > 0 ? slippage : DEFAULT_SLIPPAGE_PCT
  // 1e4 denominator preserves up to two decimals of a percent (e.g. 0.05%).
  return new Percent(Math.round(pct * 100), 10_000)
}

function toDeadline(deadline?: number): number {
  return deadline && deadline > 0 ? deadline : Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECS
}

function toTxRequest(calldata: string, value: string, from: string): TransactionRequest {
  return new TransactionRequest({
    to: NPM_ADDRESS,
    data: calldata,
    value: BigNumber.from(value).toString(),
    chainId: GNOSIS_CHAIN_ID,
    from,
  })
}

const decimalsCache = new Map<string, number>()
async function getDecimals(address: string): Promise<number> {
  const key = address.toLowerCase()
  const cached = decimalsCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  const decimals = Number(await erc20Contract(address).decimals())
  decimalsCache.set(key, decimals)
  return decimals
}

interface PoolWithMeta {
  pool: Pool
  address: string
}

/** Build an SDK Pool for an existing pool given its address (reads live state). */
async function buildPoolFromAddress(poolAddress: string): Promise<PoolWithMeta> {
  const contract = poolContract(poolAddress)
  const [token0Addr, token1Addr, fee, slot0, liquidity] = await Promise.all([
    contract.token0(),
    contract.token1(),
    contract.fee(),
    contract.slot0(),
    contract.liquidity(),
  ])
  const [dec0, dec1] = await Promise.all([getDecimals(token0Addr), getDecimals(token1Addr)])
  const token0 = new Token(GNOSIS_CHAIN_ID, token0Addr, dec0)
  const token1 = new Token(GNOSIS_CHAIN_ID, token1Addr, dec1)
  const pool = new Pool(token0, token1, Number(fee), slot0.sqrtPriceX96.toString(), liquidity.toString(), slot0.tick)
  return { pool, address: poolAddress }
}

/** Resolve + build an existing SDK Pool for a (token0, token1, fee) tuple. */
async function buildPoolForTokens(token0Address: string, token1Address: string, fee: number): Promise<PoolWithMeta> {
  const poolAddress = await factoryContract().getPool(
    toPoolTokenAddress(token0Address),
    toPoolTokenAddress(token1Address),
    fee,
  )
  if (!poolAddress || isNativeAddress(poolAddress)) {
    throw new Error(`Gnosis V3 pool not found for ${token0Address}/${token1Address} fee ${fee}`)
  }
  return buildPoolFromAddress(poolAddress)
}

/** Build a brand-new (uninitialized) SDK Pool from create-pool parameters. */
function buildNewPool(token0Address: string, token1Address: string, fee: number, initialPriceX96: string): Pool {
  const tick = TickMath.getTickAtSqrtRatio(JSBI.BigInt(initialPriceX96))
  // Token decimals don't affect the raw X96 price/tick math used to build calldata.
  const token0 = new Token(GNOSIS_CHAIN_ID, toPoolTokenAddress(token0Address), 18)
  const token1 = new Token(GNOSIS_CHAIN_ID, toPoolTokenAddress(token1Address), 18)
  return new Pool(token0, token1, fee, initialPriceX96, '0', tick)
}

function buildPositionFromAmounts(args: {
  pool: Pool
  tickLower: number
  tickUpper: number
  amountsByAddress: Map<string, string>
}): Position {
  const { pool, tickLower, tickUpper, amountsByAddress } = args
  const amount0 = amountsByAddress.get(pool.token0.address.toLowerCase())
  const amount1 = amountsByAddress.get(pool.token1.address.toLowerCase())

  if (amount0 !== undefined && amount1 !== undefined) {
    return Position.fromAmounts({ pool, tickLower, tickUpper, amount0, amount1, useFullPrecision: true })
  }
  if (amount0 !== undefined) {
    return Position.fromAmount0({ pool, tickLower, tickUpper, amount0, useFullPrecision: true })
  }
  if (amount1 !== undefined) {
    return Position.fromAmount1({ pool, tickLower, tickUpper, amount1 })
  }
  throw new Error('No deposit amounts provided')
}

/** LPToken in the request's (display) token order, populated with computed amounts. */
function buildResponseTokens(
  pool: Pool,
  position: Position,
  displayToken0Address: string,
  displayToken1Address: string,
): { token0: LPToken; token1: LPToken } {
  const { amount0, amount1 } = position.mintAmounts
  const amountByPoolAddr = new Map<string, string>([
    [pool.token0.address.toLowerCase(), amount0.toString()],
    [pool.token1.address.toLowerCase(), amount1.toString()],
  ])
  const amountFor = (displayAddress: string): string =>
    amountByPoolAddr.get(toPoolTokenAddress(displayAddress).toLowerCase()) ?? '0'
  return {
    token0: new LPToken({ tokenAddress: displayToken0Address, amount: amountFor(displayToken0Address) }),
    token1: new LPToken({ tokenAddress: displayToken1Address, amount: amountFor(displayToken1Address) }),
  }
}

function maybeUseNative(token0Address: string, token1Address: string): AddLiquidityOptions['useNative'] {
  return isNativeAddress(token0Address) || isNativeAddress(token1Address) ? nativeOnChain(GNOSIS_CHAIN_ID) : undefined
}

// ---------------------------------------------------------------------------
// Uncollected fees (mirrors UniswapV3 Position fee accounting, uint256-wrapping)
// ---------------------------------------------------------------------------

function sub256(a: JSBI, b: JSBI): JSBI {
  return JSBI.bitwiseAnd(JSBI.subtract(a, b), MAX_UINT256)
}

interface PositionOnChain {
  token0: string
  token1: string
  fee: number
  tickLower: number
  tickUpper: number
  liquidity: BigNumber
  feeGrowthInside0LastX128: BigNumber
  feeGrowthInside1LastX128: BigNumber
  tokensOwed0: BigNumber
  tokensOwed1: BigNumber
}

async function readPosition(tokenId: string): Promise<PositionOnChain> {
  const p = await npmReadContract().positions(BigNumber.from(tokenId))
  return {
    token0: p.token0,
    token1: p.token1,
    fee: Number(p.fee),
    tickLower: Number(p.tickLower),
    tickUpper: Number(p.tickUpper),
    liquidity: BigNumber.from(p.liquidity),
    feeGrowthInside0LastX128: BigNumber.from(p.feeGrowthInside0LastX128),
    feeGrowthInside1LastX128: BigNumber.from(p.feeGrowthInside1LastX128),
    tokensOwed0: BigNumber.from(p.tokensOwed0),
    tokensOwed1: BigNumber.from(p.tokensOwed1),
  }
}

async function computeUncollectedFees(
  poolAddress: string,
  onChain: PositionOnChain,
  tickCurrent: number,
): Promise<{ fee0: JSBI; fee1: JSBI }> {
  const contract = poolContract(poolAddress)
  const [global0, global1, lower, upper] = await Promise.all([
    contract.feeGrowthGlobal0X128(),
    contract.feeGrowthGlobal1X128(),
    contract.ticks(onChain.tickLower),
    contract.ticks(onChain.tickUpper),
  ])

  const liquidity = JSBI.BigInt(onChain.liquidity.toString())
  const calc = (
    feeGrowthGlobalX128: JSBI,
    outsideLowerX128: JSBI,
    outsideUpperX128: JSBI,
    insideLastX128: JSBI,
    tokensOwed: JSBI,
  ): JSBI => {
    const below = tickCurrent >= onChain.tickLower ? outsideLowerX128 : sub256(feeGrowthGlobalX128, outsideLowerX128)
    const above = tickCurrent < onChain.tickUpper ? outsideUpperX128 : sub256(feeGrowthGlobalX128, outsideUpperX128)
    const inside = sub256(sub256(feeGrowthGlobalX128, below), above)
    const delta = sub256(inside, insideLastX128)
    return JSBI.add(tokensOwed, JSBI.divide(JSBI.multiply(delta, liquidity), Q128))
  }

  return {
    fee0: calc(
      JSBI.BigInt(global0.toString()),
      JSBI.BigInt(lower.feeGrowthOutside0X128.toString()),
      JSBI.BigInt(upper.feeGrowthOutside0X128.toString()),
      JSBI.BigInt(onChain.feeGrowthInside0LastX128.toString()),
      JSBI.BigInt(onChain.tokensOwed0.toString()),
    ),
    fee1: calc(
      JSBI.BigInt(global1.toString()),
      JSBI.BigInt(lower.feeGrowthOutside1X128.toString()),
      JSBI.BigInt(upper.feeGrowthOutside1X128.toString()),
      JSBI.BigInt(onChain.feeGrowthInside1LastX128.toString()),
      JSBI.BigInt(onChain.tokensOwed1.toString()),
    ),
  }
}

// ---------------------------------------------------------------------------
// Create / Increase / Decrease / Collect / Approval builders
// ---------------------------------------------------------------------------

export async function buildGnosisCreatePosition(params: CreatePositionRequest): Promise<CreatePositionResponse> {
  const poolCase = params.pool
  if (params.tickPrice.case !== 'tickBounds') {
    throw new Error('Gnosis create requires tick bounds')
  }
  const { tickLower, tickUpper } = params.tickPrice.value

  let poolMeta: PoolWithMeta
  let createPool = false
  let displayToken0 = ''
  let displayToken1 = ''

  if (poolCase.case === 'existingPool') {
    displayToken0 = poolCase.value.token0Address
    displayToken1 = poolCase.value.token1Address
    poolMeta = await buildPoolFromAddress(poolCase.value.poolReference)
  } else if (poolCase.case === 'newPool') {
    createPool = true
    displayToken0 = poolCase.value.token0Address
    displayToken1 = poolCase.value.token1Address
    const pool = buildNewPool(
      poolCase.value.token0Address,
      poolCase.value.token1Address,
      poolCase.value.fee,
      poolCase.value.initialPrice,
    )
    poolMeta = { pool, address: ZERO_ADDRESS }
  } else {
    throw new Error('Gnosis create requires a pool')
  }

  const amountsByAddress = new Map<string, string>()
  if (params.independentToken) {
    amountsByAddress.set(
      toPoolTokenAddress(params.independentToken.tokenAddress).toLowerCase(),
      params.independentToken.amount,
    )
  }
  if (params.dependentToken) {
    amountsByAddress.set(
      toPoolTokenAddress(params.dependentToken.tokenAddress).toLowerCase(),
      params.dependentToken.amount,
    )
  }

  const position = buildPositionFromAmounts({ pool: poolMeta.pool, tickLower, tickUpper, amountsByAddress })

  const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, {
    recipient: params.walletAddress,
    slippageTolerance: toPercent(params.slippageTolerance),
    deadline: toDeadline(params.deadline),
    createPool,
    useNative: maybeUseNative(displayToken0, displayToken1),
  })

  const { token0, token1 } = buildResponseTokens(poolMeta.pool, position, displayToken0, displayToken1)
  return new CreatePositionResponse({
    create: toTxRequest(calldata, value, params.walletAddress),
    token0,
    token1,
    tickLower,
    tickUpper,
  })
}

export async function buildGnosisIncreasePosition(params: IncreasePositionRequest): Promise<IncreasePositionResponse> {
  if (!params.nftTokenId) {
    throw new Error('Gnosis increase requires nftTokenId')
  }
  const onChain = await readPosition(params.nftTokenId)
  const { pool } = await buildPoolForTokens(onChain.token0, onChain.token1, onChain.fee)

  const amountsByAddress = new Map<string, string>()
  if (params.independentToken) {
    amountsByAddress.set(
      toPoolTokenAddress(params.independentToken.tokenAddress).toLowerCase(),
      params.independentToken.amount,
    )
  }
  const position = buildPositionFromAmounts({
    pool,
    tickLower: onChain.tickLower,
    tickUpper: onChain.tickUpper,
    amountsByAddress,
  })

  const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, {
    tokenId: params.nftTokenId,
    slippageTolerance: toPercent(params.slippageTolerance),
    deadline: toDeadline(params.deadline),
    useNative: maybeUseNative(params.token0Address, params.token1Address),
  })

  const { token0, token1 } = buildResponseTokens(pool, position, params.token0Address, params.token1Address)
  return new IncreasePositionResponse({
    increase: toTxRequest(calldata, value, params.walletAddress),
    token0,
    token1,
  })
}

export async function buildGnosisDecreasePosition(params: DecreasePositionRequest): Promise<DecreasePositionResponse> {
  if (!params.nftTokenId) {
    throw new Error('Gnosis decrease requires nftTokenId')
  }
  const onChain = await readPosition(params.nftTokenId)
  const poolMeta = await buildPoolForTokens(onChain.token0, onChain.token1, onChain.fee)
  const { pool } = poolMeta

  const position = new Position({
    pool,
    liquidity: onChain.liquidity.toString(),
    tickLower: onChain.tickLower,
    tickUpper: onChain.tickUpper,
  })

  const { fee0, fee1 } = await computeUncollectedFees(poolMeta.address, onChain, pool.tickCurrent)

  // Honor the unwrap preference: when the user asked for native xDAI
  // (withdrawAsWeth === false) and a side is WXDAI (== WETH9[100]), use the native
  // currency so the v3 SDK appends unwrapWETH9 and the recipient receives xDAI.
  const wantNative = params.withdrawAsWeth === false
  const isWxdai = (token: Token): boolean => token.address.toLowerCase() === WXDAI_ADDRESS.toLowerCase()
  const owed0 = wantNative && isWxdai(pool.token0) ? nativeOnChain(GNOSIS_CHAIN_ID) : pool.token0
  const owed1 = wantNative && isWxdai(pool.token1) ? nativeOnChain(GNOSIS_CHAIN_ID) : pool.token1

  const { calldata, value } = NonfungiblePositionManager.removeCallParameters(position, {
    tokenId: params.nftTokenId,
    liquidityPercentage: new Percent(params.liquidityPercentageToDecrease, 100),
    slippageTolerance: toPercent(params.slippageTolerance),
    deadline: toDeadline(params.deadline),
    burnToken: false,
    collectOptions: {
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(owed0, fee0),
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(owed1, fee1),
      recipient: params.walletAddress,
    },
  })

  return new DecreasePositionResponse({
    decrease: toTxRequest(calldata, value, params.walletAddress),
  })
}

export async function buildGnosisClaimFees(params: ClaimFeesRequest): Promise<ClaimFeesResponse> {
  if (!params.tokenId) {
    throw new Error('Gnosis claim fees requires tokenId')
  }
  const onChain = await readPosition(params.tokenId)
  const poolMeta = await buildPoolForTokens(onChain.token0, onChain.token1, onChain.fee)
  const { pool } = poolMeta

  const { fee0, fee1 } = await computeUncollectedFees(poolMeta.address, onChain, pool.tickCurrent)

  const { calldata, value } = NonfungiblePositionManager.collectCallParameters({
    tokenId: params.tokenId,
    expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(pool.token0, fee0),
    expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(pool.token1, fee1),
    recipient: params.walletAddress,
  })

  return new ClaimFeesResponse({
    claim: toTxRequest(calldata, value, params.walletAddress),
  })
}

export async function buildGnosisCheckApproval(params: LPApprovalRequest): Promise<LPApprovalResponse> {
  // Decrease/collect operate on an NFT the wallet already owns — no ERC20 approval.
  if (params.action === LPAction.DECREASE) {
    return new LPApprovalResponse({ transactions: [] })
  }

  const transactions: ApprovalTransactionRequest[] = []

  for (const lpToken of params.lpTokens) {
    if (!lpToken.amount || lpToken.amount === '0' || isNativeAddress(lpToken.tokenAddress)) {
      continue
    }
    const allowance = await erc20Contract(lpToken.tokenAddress).allowance(params.walletAddress, NPM_ADDRESS)
    if (allowance.gte(BigNumber.from(lpToken.amount))) {
      continue
    }
    const calldata = ERC20_INTERFACE.encodeFunctionData('approve', [NPM_ADDRESS, BigNumber.from(lpToken.amount)])
    transactions.push(
      new ApprovalTransactionRequest({
        transaction: new TransactionRequest({
          to: lpToken.tokenAddress,
          from: params.walletAddress,
          data: calldata,
          value: '0',
          chainId: GNOSIS_CHAIN_ID,
        }),
        cancelApproval: false,
        action: params.action,
      }),
    )
  }

  return new LPApprovalResponse({ transactions })
}
