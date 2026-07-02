import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import type { JsonRpcProvider } from '@ethersproject/providers'
import { FeeAmount } from '@uniswap/v3-sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getGnosisSharedStateTokenAddresses } from 'uniswap/src/features/tokens/gnosisCanonicalTokens'
import {
  MULTICALL3_ABI,
  V3_FACTORY_ABI,
  V3_POOL_STATE_ABI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_FEE_TIERS,
  GNOSIS_MULTICALL3_ADDRESS,
  GNOSIS_V3_FACTORY_ADDRESS,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  fetchGnosisTopV3Pools,
  type GnosisTopPool,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolTvl'
import {
  normalizeGnosisRouteTokenAddress,
  type GnosisPoolGraphEdge,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const POOL_DISCOVERY_TTL_MS = 15_000

const factoryInterface = new Interface(V3_FACTORY_ABI)
const poolInterface = new Interface(V3_POOL_STATE_ABI)

interface Multicall3 {
  callStatic: {
    aggregate3: (
      calls: { target: string; allowFailure: boolean; callData: string }[],
    ) => Promise<{ success: boolean; returnData: string }[]>
  }
}

export interface GnosisPoolDiscoveryCandidate {
  tokenA: string
  tokenB: string
  fee: FeeAmount
}

interface ExistingGnosisPool extends GnosisPoolDiscoveryCandidate {
  poolAddress: string
  tvlUSD?: number
}

interface PoolStateRead {
  sqrtPriceX96?: BigNumber
  tick?: number
  liquidity?: BigNumber
}

const poolDiscoveryCache = new Map<string, { edges: GnosisPoolGraphEdge[]; ts: number }>()

function getMulticall(provider: JsonRpcProvider): Multicall3 {
  return new Contract(GNOSIS_MULTICALL3_ADDRESS, MULTICALL3_ABI, provider) as unknown as Multicall3
}

function normalizeUniqueTokens(tokens: readonly string[]): string[] {
  return [...new Set(tokens.map(normalizeGnosisRouteTokenAddress))]
}

function expandGnosisSharedStateTokens(tokens: readonly string[]): string[] {
  return tokens.flatMap((token) =>
    getGnosisSharedStateTokenAddresses({ chainId: UniverseChainId.Gnosis, address: token }),
  )
}

function getPoolDiscoveryCacheKey(args: {
  tokens: readonly string[]
  feeTiers: readonly FeeAmount[]
  routingHubs: readonly string[]
}): string {
  return [
    [...args.tokens].sort().join(':'),
    [...args.routingHubs].sort().join(':'),
    [...args.feeTiers].sort((a, b) => a - b).join(':'),
  ].join('|')
}

function isNonZeroAddress(address: string | undefined): address is string {
  return Boolean(address && address.toLowerCase() !== ZERO_ADDRESS)
}

export function buildGnosisPoolDiscoveryCandidates({
  tokenIn,
  tokenOut,
  routingHubs = GNOSIS_BASE_TOKENS,
  feeTiers = GNOSIS_FEE_TIERS,
}: {
  tokenIn: string
  tokenOut: string
  routingHubs?: readonly string[]
  feeTiers?: readonly FeeAmount[]
}): GnosisPoolDiscoveryCandidate[] {
  const tokens = normalizeUniqueTokens(expandGnosisSharedStateTokens([tokenIn, tokenOut, ...routingHubs]))
  const candidates: GnosisPoolDiscoveryCandidate[] = []

  for (let i = 0; i < tokens.length; i++) {
    const tokenA = tokens[i]
    if (!tokenA) {
      continue
    }

    for (let j = i + 1; j < tokens.length; j++) {
      const tokenB = tokens[j]
      if (!tokenB || tokenA === tokenB) {
        continue
      }

      for (const fee of feeTiers) {
        candidates.push({ tokenA, tokenB, fee })
      }
    }
  }

  return candidates
}

export async function discoverGnosisPoolGraphEdges({
  provider,
  tokenIn,
  tokenOut,
  routingHubs = GNOSIS_BASE_TOKENS,
  feeTiers = GNOSIS_FEE_TIERS,
}: {
  provider: JsonRpcProvider
  tokenIn: string
  tokenOut: string
  routingHubs?: readonly string[]
  feeTiers?: readonly FeeAmount[]
}): Promise<GnosisPoolGraphEdge[]> {
  const now = Date.now()
  const normalizedHubs = normalizeUniqueTokens(expandGnosisSharedStateTokens(routingHubs))
  const tokens = normalizeUniqueTokens(expandGnosisSharedStateTokens([tokenIn, tokenOut, ...normalizedHubs]))
  const cacheKey = getPoolDiscoveryCacheKey({ tokens, feeTiers, routingHubs: normalizedHubs })
  const cached = poolDiscoveryCache.get(cacheKey)
  if (cached && now - cached.ts < POOL_DISCOVERY_TTL_MS) {
    return cached.edges
  }

  const adapterPools = await fetchGnosisTopV3Pools()
  const existingPools = adapterPools?.length
    ? await collectAdapterBackedPools({
        provider,
        adapterPools,
        tokenIn,
        tokenOut,
        routingHubs: normalizedHubs,
        feeTiers,
      })
    : // Adapter unavailable/unconfigured/empty: fall back to probing the factory for the full
      // {tokenIn, tokenOut, hubs} pair matrix, exactly as before the adapter path existed.
      await readExistingPools({
        provider,
        candidates: buildGnosisPoolDiscoveryCandidates({ tokenIn, tokenOut, routingHubs: normalizedHubs, feeTiers }),
      })
  const edges = await readPoolGraphEdges({ provider, pools: existingPools })
  poolDiscoveryCache.set(cacheKey, { edges, ts: now })
  return edges
}

/**
 * Pool set for the adapter-backed discovery path: every pool the analytics adapter has indexed
 * (the complete graph, TVL attached — no factory probing for it), unioned with a factory probe of
 * just the tokenIn/tokenOut pairs against {each other + hubs}. The union probe exists because the
 * adapter indexes with a small lag: a brand-new pool on the quoted endpoints would otherwise be
 * invisible until backfill catches up, regressing quotes that factory discovery used to find. The
 * probe is a fraction of the old full pair matrix (endpoints only, not hub×hub), so the adapter
 * path still replaces the bulk of the per-quote factory calls.
 */
async function collectAdapterBackedPools({
  provider,
  adapterPools,
  tokenIn,
  tokenOut,
  routingHubs,
  feeTiers,
}: {
  provider: JsonRpcProvider
  adapterPools: readonly GnosisTopPool[]
  tokenIn: string
  tokenOut: string
  routingHubs: readonly string[]
  feeTiers: readonly FeeAmount[]
}): Promise<ExistingGnosisPool[]> {
  const feeTierSet = new Set<number>(feeTiers)
  const poolsByAddress = new Map<string, ExistingGnosisPool>()

  for (const pool of adapterPools) {
    const tokenA = normalizeGnosisRouteTokenAddress(pool.token0.address)
    const tokenB = normalizeGnosisRouteTokenAddress(pool.token1.address)
    if (!tokenA || !tokenB || tokenA === tokenB || !feeTierSet.has(pool.fee)) {
      continue
    }
    poolsByAddress.set(pool.address.toLowerCase(), {
      tokenA,
      tokenB,
      fee: pool.fee as FeeAmount,
      poolAddress: pool.address,
      tvlUSD: pool.tvlUSD,
    })
  }

  const probedPools = await readExistingPools({
    provider,
    candidates: buildEndpointDiscoveryCandidates({ tokenIn, tokenOut, routingHubs, feeTiers }),
  })
  for (const pool of probedPools) {
    const key = pool.poolAddress.toLowerCase()
    if (!poolsByAddress.has(key)) {
      poolsByAddress.set(key, pool)
    }
  }

  return [...poolsByAddress.values()]
}

/** Pair candidates touching tokenIn/tokenOut only (endpoints × {endpoints + hubs}), not hub×hub. */
function buildEndpointDiscoveryCandidates({
  tokenIn,
  tokenOut,
  routingHubs,
  feeTiers,
}: {
  tokenIn: string
  tokenOut: string
  routingHubs: readonly string[]
  feeTiers: readonly FeeAmount[]
}): GnosisPoolDiscoveryCandidate[] {
  const endpointTokens = normalizeUniqueTokens(expandGnosisSharedStateTokens([tokenIn, tokenOut]))
  const counterpartTokens = normalizeUniqueTokens(expandGnosisSharedStateTokens([tokenIn, tokenOut, ...routingHubs]))
  const candidates: GnosisPoolDiscoveryCandidate[] = []
  const seenPairs = new Set<string>()

  for (const endpointToken of endpointTokens) {
    for (const counterpartToken of counterpartTokens) {
      if (!endpointToken || !counterpartToken || endpointToken === counterpartToken) {
        continue
      }
      const pairKey =
        endpointToken < counterpartToken
          ? `${endpointToken}:${counterpartToken}`
          : `${counterpartToken}:${endpointToken}`
      if (seenPairs.has(pairKey)) {
        continue
      }
      seenPairs.add(pairKey)
      for (const fee of feeTiers) {
        candidates.push({ tokenA: endpointToken, tokenB: counterpartToken, fee })
      }
    }
  }

  return candidates
}

async function readExistingPools({
  provider,
  candidates,
}: {
  provider: JsonRpcProvider
  candidates: readonly GnosisPoolDiscoveryCandidate[]
}): Promise<ExistingGnosisPool[]> {
  if (!candidates.length) {
    return []
  }

  const calls = candidates.map((candidate) => ({
    target: GNOSIS_V3_FACTORY_ADDRESS,
    allowFailure: true,
    callData: factoryInterface.encodeFunctionData('getPool', [candidate.tokenA, candidate.tokenB, candidate.fee]),
  }))
  const results = await getMulticall(provider).callStatic.aggregate3(calls)
  const pools: ExistingGnosisPool[] = []

  results.forEach((result, index) => {
    const candidate = candidates[index]
    if (!candidate || !result.success) {
      return
    }

    try {
      const poolAddress = factoryInterface.decodeFunctionResult('getPool', result.returnData)[0]
      if (isNonZeroAddress(poolAddress)) {
        pools.push({ ...candidate, poolAddress })
      }
    } catch {
      // Ignore undecodable factory results.
    }
  })

  return pools
}

async function readPoolGraphEdges({
  provider,
  pools,
}: {
  provider: JsonRpcProvider
  pools: readonly ExistingGnosisPool[]
}): Promise<GnosisPoolGraphEdge[]> {
  if (!pools.length) {
    return []
  }

  const calls: { target: string; allowFailure: boolean; callData: string }[] = []
  const tags: { index: number; kind: 'slot0' | 'liquidity' }[] = []
  pools.forEach((pool, index) => {
    calls.push({ target: pool.poolAddress, allowFailure: true, callData: poolInterface.encodeFunctionData('slot0') })
    tags.push({ index, kind: 'slot0' })
    calls.push({
      target: pool.poolAddress,
      allowFailure: true,
      callData: poolInterface.encodeFunctionData('liquidity'),
    })
    tags.push({ index, kind: 'liquidity' })
  })

  const reads = pools.map((): PoolStateRead => ({}))
  const results = await getMulticall(provider).callStatic.aggregate3(calls)
  results.forEach((result, index) => {
    const tag = tags[index]
    if (!tag || !result.success) {
      return
    }

    try {
      const read = reads[tag.index]
      if (!read) {
        return
      }

      if (tag.kind === 'slot0') {
        const decoded = poolInterface.decodeFunctionResult('slot0', result.returnData)
        read.sqrtPriceX96 = BigNumber.from(decoded[0])
        read.tick = Number(decoded[1])
      } else {
        read.liquidity = BigNumber.from(poolInterface.decodeFunctionResult('liquidity', result.returnData)[0])
      }
    } catch {
      // Ignore undecodable pool results.
    }
  })

  return pools.map((pool, index) => {
    const read = reads[index]
    const sqrtPriceX96 = read?.sqrtPriceX96 ?? BigNumber.from(0)
    const liquidity = read?.liquidity ?? BigNumber.from(0)
    return {
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      fee: pool.fee,
      liquidity,
      initialized: sqrtPriceX96.gt(0),
      poolAddress: pool.poolAddress,
      tvlUSD: pool.tvlUSD,
      sqrtPriceX96,
      tick: read?.tick,
    }
  })
}

export function clearGnosisPoolDiscoveryCache(): void {
  poolDiscoveryCache.clear()
}
