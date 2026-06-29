/* oxlint-disable max-lines -- cohesive client-side Gnosis quote provider; splitting would scatter tightly-coupled multicall logic */
import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import type { JsonRpcProvider } from '@ethersproject/providers'
import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { computePoolAddress, FeeAmount, Pool, Route, Trade } from '@uniswap/v3-sdk'
import { type DiscriminatedQuoteResponse, TradingApi } from '@universe/api'
import { BIPS_BASE } from 'uniswap/src/constants/misc'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  ERC20_METADATA_ABI,
  MULTICALL3_ABI,
  PERMIT2_ABI,
  QUOTER_V2_ABI,
  SDAI_ERC4626_PREVIEW_ABI,
  V3_POOL_STATE_ABI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_AGGREGATION_QUOTE_ID,
  GnosisAggregationStepType,
  GnosisTransmuteDirection,
  type GnosisAggregationLeg,
  type GnosisAggregationQuote,
  type GnosisAggregationStep,
  type GnosisCurveRouteSpec,
  curveRouterInterface,
  encodeGnosisAggregationCurveStepData,
  encodeGnosisAggregationTransmuteStepData,
  encodeGnosisAggregationV3StepData,
  getGnosisCurveDirectPoolRoute,
  getGnosisCurveEureUsdRoute,
  getGnosisCurveX3PoolRoute,
  getGnosisTransmuteDirection,
  isGnosisAggregationEnabled,
  usdcTransmuterInterface,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter'
import {
  buildPermit2ApproveData,
  PERMIT2_ADDRESS,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/approvals'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_EURE_V1,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_GNO,
  GNOSIS_INDICATIVE_QUOTE_TIMEOUT_MS,
  GNOSIS_MAX_SPLIT_LEGS,
  GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT,
  GNOSIS_MIN_CANDIDATE_POOL_TVL_USD,
  GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS,
  GNOSIS_MULTICALL3_ADDRESS,
  GNOSIS_CURVE_ROUTER_ADDRESS,
  GNOSIS_OSGNO,
  GNOSIS_QUOTE_TIMEOUT_MS,
  GNOSIS_QUOTER_ADDRESS,
  GNOSIS_ROUTE_HOP_TIERS,
  GNOSIS_SDAI,
  GNOSIS_SPLIT_ENABLED,
  GNOSIS_SPLIT_GRID_STEPS,
  GNOSIS_USDC,
  GNOSIS_USDC_TRANSMUTER_ADDRESS,
  GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
  GNOSIS_USDCE,
  GNOSIS_USDT,
  GNOSIS_V3_FACTORY_ADDRESS,
  GNOSIS_WETH,
  GNOSIS_WSTETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { discoverGnosisPoolGraphEdges } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolDiscovery'
import { annotateGnosisPoolGraphEdgesWithTvl } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolTvl'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import {
  buildGnosisPoolGraph,
  buildGnosisRouteCandidates,
  filterGnosisPoolGraphEdgesByTvl,
  getGnosisRouteKey,
  getRoutePoolKey,
  hasGnosisPoolTvlMetadata,
  type CandidateRoute,
  type GnosisPoolGraphEdge,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import {
  haveSameEndpoints,
  pickDisjointSet,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeDisjoint'
import { logger } from 'utilities/src/logger/logger'
import {
  GnosisSdaiAdapterDirection,
  GNOSIS_SDAI_ADAPTER_QUOTE_ID,
  getGnosisSdaiAdapterDirection,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import {
  GNOSIS_SDAI_ZAP_ADAPTER_GAS,
  GNOSIS_SDAI_ZAP_QUOTE_ID,
  GnosisSdaiZapDirection,
  getGnosisSdaiZapEligibility,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiZap'
import {
  activeLegCount,
  enumerateAllocations,
  passesAcceptGate,
  selectBestSplit,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/splitAllocation'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis as unknown as TradingApi.ChainId

const DEFAULT_GNOSIS_SLIPPAGE_PERCENT = 0.5
// Hard ceiling on slippage for EVERY Gnosis route (zap, aggregation, plain v3). The deployed
// routers enforce only an absolute amountOutMinimum and hold no notion of a fair price, so this
// off-chain clamp is the single place a percentage cap can live. A trade that genuinely needs
// more than this reverts on-chain against the floor (fails safe; the user keeps their input).
export const GNOSIS_MAX_SLIPPAGE_PERCENT = 5
// Static gas allowance (in gas units) for the standalone Permit2.approve permit tx.
const PERMIT2_APPROVE_GAS = 55_000
const PERMIT2_APPROVE_EXPIRATION_SECONDS = 30 * 60
// The TradingAPI placeholder swapper used for unconnected quotes — skip permit lookups for it.
const UNCONNECTED_SWAPPER = '0xAAAA44272dc658575Ba38f43C438447dDED45358'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Native xDAI is signalled to the trading pipeline as the zero address (and legacy 0xeee…);
// we quote it against the WXDAI pools and re-emit the native sentinel on the quote so the
// universal-router-sdk emits WRAP_ETH / UNWRAP_WETH and the correct msg.value.
function isNativeSentinel(address: string): boolean {
  const a = address.toLowerCase()
  return a === ZERO_ADDRESS || a === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
}

const quoterInterface = new Interface(QUOTER_V2_ABI)
const poolInterface = new Interface(V3_POOL_STATE_ABI)
const erc20MetaInterface = new Interface(ERC20_METADATA_ABI)
const permit2Interface = new Interface(PERMIT2_ABI)
const sdaiPreviewInterface = new Interface(SDAI_ERC4626_PREVIEW_ABI)
const erc20BalanceInterface = new Interface(['function balanceOf(address) view returns (uint256)'])

export function getGnosisSlippageTolerance(params: Pick<TradingApi.QuoteRequest, 'slippageTolerance'>): number {
  const requested = params.slippageTolerance ?? DEFAULT_GNOSIS_SLIPPAGE_PERCENT
  return Math.min(GNOSIS_MAX_SLIPPAGE_PERCENT, Math.max(0, requested))
}

function getSlippageBips(slippagePercent: number): number {
  return Math.max(0, Math.round(slippagePercent * 100))
}

export function getGnosisQuoteSlippageAmounts(args: {
  amountIn: BigNumber
  amountOut: BigNumber
  tradeType: TradingApi.TradeType
  slippagePercent: number
}): { maximumAmountIn: BigNumber; minimumAmountOut: BigNumber } {
  const { amountIn, amountOut, tradeType, slippagePercent } = args
  const slippageBips = getSlippageBips(slippagePercent)

  if (tradeType === TradingApi.TradeType.EXACT_OUTPUT) {
    return {
      maximumAmountIn: amountIn.mul(BIPS_BASE + slippageBips).div(BIPS_BASE),
      minimumAmountOut: amountOut,
    }
  }

  return {
    maximumAmountIn: amountIn,
    minimumAmountOut: amountOut.mul(BIPS_BASE).div(BIPS_BASE + slippageBips),
  }
}

interface TokenMeta {
  address: string
  symbol: string
  decimals: number
}

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [GNOSIS_WXDAI.toLowerCase()]: { symbol: 'WXDAI', decimals: 18 },
  [GNOSIS_USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  [GNOSIS_USDCE.toLowerCase()]: { symbol: 'USDC.e', decimals: 6 },
  [GNOSIS_USDT.toLowerCase()]: { symbol: 'USDT', decimals: 6 },
  [GNOSIS_WETH.toLowerCase()]: { symbol: 'WETH', decimals: 18 },
  [GNOSIS_WSTETH.toLowerCase()]: { symbol: 'wstETH', decimals: 18 },
  [GNOSIS_SDAI.toLowerCase()]: { symbol: 'sDAI', decimals: 18 },
  [GNOSIS_GNO.toLowerCase()]: { symbol: 'GNO', decimals: 18 },
  [GNOSIS_OSGNO.toLowerCase()]: { symbol: 'osGNO', decimals: 18 },
  [GNOSIS_EURE_V2.toLowerCase()]: { symbol: 'EURe', decimals: 18 },
  [GNOSIS_EURE_V1.toLowerCase()]: { symbol: 'EURe', decimals: 18 },
  [GNOSIS_GBPE_V2.toLowerCase()]: { symbol: 'GBPe', decimals: 18 },
  [GNOSIS_GBPE_V1.toLowerCase()]: { symbol: 'GBPe', decimals: 18 },
}

// Token metadata is immutable, so cache it across quotes/keystrokes indefinitely.
const tokenMetaCache = new Map<string, TokenMeta>()
// Pool state changes every block; cache it only briefly to dedupe rapid refetches.
const POOL_STATE_TTL_MS = 3_000
interface PoolState {
  sqrtPriceX96: BigNumber
  tick: number
  liquidity: BigNumber
}
const poolStateCache = new Map<string, { state: PoolState; ts: number }>()

interface Multicall3 {
  callStatic: {
    aggregate3: (
      calls: { target: string; allowFailure: boolean; callData: string }[],
    ) => Promise<{ success: boolean; returnData: string }[]>
  }
}

function getMulticall(provider: JsonRpcProvider): Multicall3 {
  return new Contract(GNOSIS_MULTICALL3_ADDRESS, MULTICALL3_ABI, provider) as unknown as Multicall3
}

function withTimeout<T>(args: { promise: Promise<T>; ms: number; label: string }): Promise<T> {
  const { promise, ms, label } = args
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Gnosis ${label} timed out after ${ms}ms`)), ms)),
  ])
}

/** Packs a V3 path: token(20) | fee(3) | token(20) | … (reversed for exact-output quoting). */
function encodePath(args: { tokens: string[]; fees: FeeAmount[]; exactOutput: boolean }): string {
  const { tokens, fees, exactOutput } = args
  const orderedTokens = exactOutput ? [...tokens].reverse() : tokens
  const orderedFees = exactOutput ? [...fees].reverse() : fees
  let path = (orderedTokens[0] ?? '').toLowerCase().replace('0x', '')
  for (let i = 0; i < orderedFees.length; i++) {
    path += (orderedFees[i] ?? 0).toString(16).padStart(6, '0')
    path += (orderedTokens[i + 1] ?? '').toLowerCase().replace('0x', '')
  }
  return `0x${path}`
}

interface QuotedRoute {
  route: CandidateRoute
  amountIn: BigNumber
  amountOut: BigNumber
  gasEstimate: BigNumber
}

export interface CandidateRouteSets {
  preferredRoutes: CandidateRoute[]
  getFallbackRoutes: () => CandidateRoute[]
}

function buildCandidateRoutesFromPoolEdges(args: {
  tokenIn: string
  tokenOut: string
  poolEdges: readonly GnosisPoolGraphEdge[]
  maxHops?: number
}): CandidateRoute[] {
  return buildGnosisRouteCandidates({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    graph: buildGnosisPoolGraph(args.poolEdges),
    maxHops: args.maxHops,
  })
}

function haveSameCandidateRoutes(a: readonly CandidateRoute[], b: readonly CandidateRoute[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  const bRouteKeys = new Set(b.map(getGnosisRouteKey))
  return a.every((route) => bRouteKeys.has(getGnosisRouteKey(route)))
}

/**
 * Splits route candidates into a preferred set (built from pools that clear the TVL floor,
 * plus pools whose TVL is unknown — those are kept, not excluded) and a lazily-built fallback
 * set (the full pool graph, including confirmed sub-threshold pools). `getFallbackRoutes`
 * builds the fallback at most once and returns [] when it is identical to the preferred set,
 * so the caller never re-quotes the same routes. When no pool carries TVL metadata at all,
 * everything is preferred and there is no fallback.
 */
export function buildCandidateRouteSets(args: {
  tokenIn: string
  tokenOut: string
  poolEdges: readonly GnosisPoolGraphEdge[]
  maxHops?: number
}): CandidateRouteSets {
  if (!hasGnosisPoolTvlMetadata(args.poolEdges)) {
    return {
      preferredRoutes: buildCandidateRoutesFromPoolEdges(args),
      getFallbackRoutes: () => [],
    }
  }

  const tvlFilteredPoolEdges = filterGnosisPoolGraphEdgesByTvl(args.poolEdges, GNOSIS_MIN_CANDIDATE_POOL_TVL_USD)
  const preferredRoutes = buildCandidateRoutesFromPoolEdges({ ...args, poolEdges: tvlFilteredPoolEdges })
  let fallbackRoutes: CandidateRoute[] | undefined

  return {
    preferredRoutes,
    getFallbackRoutes: () => {
      fallbackRoutes ??= buildCandidateRoutesFromPoolEdges(args)
      return haveSameCandidateRoutes(preferredRoutes, fallbackRoutes) ? [] : fallbackRoutes
    },
  }
}

/**
 * Quotes arbitrary (route, amount) pairs in a single Multicall3 eth_call via the path-based quoter.
 * Returns one result per input pair, aligned by index (`undefined` where the pool is missing, has no
 * liquidity, or the quote is zero/undecodable). This is the shared primitive behind both candidate
 * ranking and split-fill grid allocation, so a whole grid of leg×sub-amount quotes costs one call.
 */
async function quoteRouteAmountPairs(args: {
  provider: JsonRpcProvider
  pairs: { route: CandidateRoute; amount: BigNumber }[]
  tradeType: TradingApi.TradeType
}): Promise<(QuotedRoute | undefined)[]> {
  const { provider, pairs, tradeType } = args
  if (!pairs.length) {
    return []
  }
  const exactOutput = tradeType === TradingApi.TradeType.EXACT_OUTPUT
  const fn = exactOutput ? 'quoteExactOutput' : 'quoteExactInput'
  const calls = pairs.map(({ route, amount }) => ({
    target: GNOSIS_QUOTER_ADDRESS,
    allowFailure: true,
    callData: quoterInterface.encodeFunctionData(fn, [
      encodePath({ tokens: route.tokens, fees: route.fees, exactOutput }),
      amount,
    ]),
  }))

  const results = await getMulticall(provider).callStatic.aggregate3(calls)

  return pairs.map((pair, i) => {
    const result = results[i]
    if (!result?.success) {
      return undefined // pool missing / no liquidity
    }
    try {
      const decoded = quoterInterface.decodeFunctionResult(fn, result.returnData)
      const quoted = BigNumber.from(decoded[0])
      const gasEstimate = BigNumber.from(decoded[3] ?? 0)
      if (quoted.isZero()) {
        return undefined
      }
      return exactOutput
        ? { route: pair.route, amountIn: quoted, amountOut: pair.amount, gasEstimate }
        : { route: pair.route, amountIn: pair.amount, amountOut: quoted, gasEstimate }
    } catch {
      return undefined // undecodable result
    }
  })
}

/**
 * Quotes every candidate route at `amount` in one Multicall3 call and returns the successful quotes
 * ranked best-first (max output for EXACT_INPUT, min input for EXACT_OUTPUT). The caller takes
 * `[0]` as the single best route; the full ranking is the source set for split-fill disjointness.
 */
async function quoteCandidateRoutes(args: {
  provider: JsonRpcProvider
  routes: CandidateRoute[]
  amount: BigNumber
  tradeType: TradingApi.TradeType
}): Promise<QuotedRoute[]> {
  const { provider, routes, amount, tradeType } = args
  const exactOutput = tradeType === TradingApi.TradeType.EXACT_OUTPUT
  const quoted = await quoteRouteAmountPairs({ provider, pairs: routes.map((route) => ({ route, amount })), tradeType })
  const successful = quoted.filter((q): q is QuotedRoute => q !== undefined)
  const ascending = (x: BigNumber, y: BigNumber): number => (x.lt(y) ? -1 : x.gt(y) ? 1 : 0)
  // Best first: smallest input for exact-output, largest output for exact-input.
  successful.sort((a, b) => (exactOutput ? ascending(a.amountIn, b.amountIn) : ascending(b.amountOut, a.amountOut)))
  return successful
}

/** Pool spot state keyed by canonical pool key, from discovery — no extra RPC. */
function buildPoolStateByKey(poolEdges: readonly GnosisPoolGraphEdge[]): Map<string, PoolState> {
  const byKey = new Map<string, PoolState>()
  for (const edge of poolEdges) {
    if (!edge.sqrtPriceX96 || edge.tick === undefined || edge.sqrtPriceX96.isZero()) {
      continue
    }
    byKey.set(getRoutePoolKey({ tokenA: edge.tokenA, tokenB: edge.tokenB, fee: edge.fee }), {
      sqrtPriceX96: edge.sqrtPriceX96,
      tick: edge.tick,
      liquidity: BigNumber.from(edge.liquidity),
    })
  }
  return byKey
}

/** Per-hop pool state for a route from the discovery map, or undefined if any hop is missing. */
function poolStatesForRoute(route: CandidateRoute, byKey: Map<string, PoolState>): PoolState[] | undefined {
  const states: PoolState[] = []
  for (let i = 0; i < route.fees.length; i++) {
    const a = route.tokens[i]
    const b = route.tokens[i + 1]
    const fee = route.fees[i]
    if (a === undefined || b === undefined || fee === undefined) {
      return undefined
    }
    const state = byKey.get(getRoutePoolKey({ tokenA: a, tokenB: b, fee }))
    if (!state) {
      return undefined
    }
    states.push(state)
  }
  return states
}

/** Token metadata for a route from the static known-token table, or undefined for any unknown token. */
function knownMetasForRoute(route: CandidateRoute): Map<string, TokenMeta> | undefined {
  const metas = new Map<string, TokenMeta>()
  for (const raw of route.tokens) {
    const known = KNOWN_TOKENS[raw.toLowerCase()]
    if (!known) {
      return undefined
    }
    metas.set(raw.toLowerCase(), { address: raw, symbol: known.symbol, decimals: known.decimals })
  }
  return metas
}

/**
 * Cheap price-impact estimate (%) for a quoted route from discovery state alone (no extra RPC),
 * reusing the same impact math as the firm path. Used to gate hop expansion and indicative quotes.
 * Returns 0 (treated as viable) when pool state or token metadata is unavailable, so it never
 * over-rejects — the firm path re-checks with freshly read pool state before a quote is emitted.
 */
function estimateRouteImpactPct(args: {
  quoted: QuotedRoute
  byKey: Map<string, PoolState>
  tradeType: TradingApi.TradeType
}): number {
  const states = poolStatesForRoute(args.quoted.route, args.byKey)
  const metas = knownMetasForRoute(args.quoted.route)
  if (!states || !metas) {
    return 0
  }
  return computeAggregatePriceImpact({
    legs: [args.quoted],
    poolStatesByRoute: [states],
    metas,
    tradeType: args.tradeType,
    totalAmountIn: args.quoted.amountIn,
  })
}

/** Builds + quotes the candidate set for one hop limit, returning the ranked successful quotes. */
async function quoteRankedAtHops(args: {
  provider: JsonRpcProvider
  tokenIn: string
  tokenOut: string
  poolEdges: readonly GnosisPoolGraphEdge[]
  amount: BigNumber
  tradeType: TradingApi.TradeType
  maxHops: number
}): Promise<QuotedRoute[]> {
  const { provider, tokenIn, tokenOut, poolEdges, amount, tradeType, maxHops } = args
  const { preferredRoutes, getFallbackRoutes } = buildCandidateRouteSets({ tokenIn, tokenOut, poolEdges, maxHops })
  const preferredRanked = preferredRoutes.length
    ? await quoteCandidateRoutes({ provider, routes: preferredRoutes, amount, tradeType })
    : []
  if (preferredRanked.length) {
    return preferredRanked
  }
  // No preferred route quoted (none cleared the TVL floor, or none quoted): fall back to the full
  // pool graph. getFallbackRoutes is memoized and returns [] when identical to the preferred set.
  const fallbackRoutes = getFallbackRoutes()
  return fallbackRoutes.length
    ? await quoteCandidateRoutes({ provider, routes: fallbackRoutes, amount, tradeType })
    : []
}

interface SplitResult {
  // One QuotedRoute per leg (a QuotedRoute already carries route + per-leg amountIn/amountOut/gas).
  legs: QuotedRoute[]
  totalOut: BigNumber
}

const splitPairKey = (legIndex: number, amount: BigNumber): string => `${legIndex}:${amount.toString()}`

/**
 * Split-fill quote (spec §4), EXACT_INPUT only. From the ranked candidate routes, greedily pick a
 * pool-disjoint set (so summing their independent quotes never double-counts a pool), then grid-
 * search the input allocation across the legs — every leg×sub-amount quote runs in ONE Multicall3
 * call — and return the highest-output allocation. The caller applies the accept gate and decides
 * whether to use it. Returns undefined when there is no disjoint alternative to split across.
 */
async function computeBestSplit(args: {
  provider: JsonRpcProvider
  ranked: QuotedRoute[]
  amount: BigNumber
  tradeType: TradingApi.TradeType
}): Promise<SplitResult | undefined> {
  const { provider, ranked, amount, tradeType } = args
  if (tradeType === TradingApi.TradeType.EXACT_OUTPUT) {
    return undefined // split allocation is defined over input; exact-output keeps the single best
  }
  const bestRoute = ranked[0]?.route
  if (!bestRoute) {
    return undefined
  }
  // Only split across routes that share the single best route's concrete input and output token.
  // Shared-state aliases (EURe v1/v2) are pool-disjoint and would otherwise be combined, but the swap
  // pulls one tokenIn via Permit2 and the UR reads tokenIn/tokenOut from route[0] only, so a mixed-
  // alias leg would revert for lack of a Permit2 allowance. See routeDisjoint.haveSameEndpoints.
  const legs = pickDisjointSet(
    ranked.map((r) => r.route).filter((route) => haveSameEndpoints(route, bestRoute)),
    GNOSIS_MAX_SPLIT_LEGS,
  )
  if (legs.length < 2) {
    return undefined // nothing pool-disjoint to split across
  }

  const allocations = enumerateAllocations({
    total: amount,
    legs: legs.length,
    steps: GNOSIS_SPLIT_GRID_STEPS,
    deepestLegIndex: 0, // leg 0 is the best (typically deepest) route; it absorbs the dust
  })

  // Collect the unique (leg, sub-amount) pairs across the whole grid and quote them in one call.
  const uniquePairs = new Map<string, { legIndex: number; route: CandidateRoute; amount: BigNumber }>()
  for (const allocation of allocations) {
    allocation.forEach((legAmount, legIndex) => {
      if (legAmount.isZero()) {
        return
      }
      const key = splitPairKey(legIndex, legAmount)
      const route = legs[legIndex]
      if (route && !uniquePairs.has(key)) {
        uniquePairs.set(key, { legIndex, route, amount: legAmount })
      }
    })
  }
  const pairs = [...uniquePairs.values()]
  const quoted = await quoteRouteAmountPairs({ provider, pairs, tradeType })
  const quoteByPair = new Map<string, QuotedRoute>()
  quoted.forEach((q, i) => {
    const pair = pairs[i]
    if (q && pair) {
      quoteByPair.set(splitPairKey(pair.legIndex, pair.amount), q)
    }
  })

  const best = selectBestSplit({
    allocations,
    outputForLeg: (legIndex, legAmount) => quoteByPair.get(splitPairKey(legIndex, legAmount))?.amountOut,
  })
  if (!best || activeLegCount(best.allocation) < 2) {
    return undefined // the optimum is a single route — no split
  }

  // Each grid quote for (leg, sub-amount) is already a QuotedRoute with this leg's route + amounts.
  // Zero-amount legs were never quoted (skipped above), so they resolve to undefined and drop out.
  const splitLegs = best.allocation
    .map((legAmount, legIndex) => quoteByPair.get(splitPairKey(legIndex, legAmount)))
    .filter((q): q is QuotedRoute => q !== undefined)

  return { legs: splitLegs, totalOut: best.totalOut }
}

/**
 * Decides the legs to finalize and emit: the best split when it clears the accept gate, else the
 * single best route as a one-leg list. Split-fill is skipped for USD quotes; EXACT_OUTPUT and the
 * no-disjoint-alternative cases short-circuit inside computeBestSplit.
 */
async function resolveQuoteLegs(args: {
  provider: JsonRpcProvider
  ranked: QuotedRoute[]
  best: QuotedRoute
  bestImpactPct: number
  amount: BigNumber
  tradeType: TradingApi.TradeType
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean }
}): Promise<QuotedRoute[]> {
  const { provider, ranked, best, bestImpactPct, amount, tradeType, params } = args
  const singleLeg = [best]
  if (!GNOSIS_SPLIT_ENABLED || params.isUSDQuote) {
    return singleLeg
  }
  // A split can never recover more output than the best route's price impact, so when that impact is
  // at or below the minimum-improvement floor it cannot clear the accept gate — skip the grid quote.
  if (bestImpactPct <= GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS / 100) {
    return singleLeg
  }

  const split = await computeBestSplit({ provider, ranked, amount, tradeType })
  if (!split) {
    return singleLeg
  }
  const accepted = passesAcceptGate({
    splitOutput: split.totalOut,
    singleBestOutput: best.amountOut,
    minImprovementBps: GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS,
  })
  return accepted ? split.legs : singleLeg
}

const AGGREGATION_ROUTER_OVERHEAD_GAS = BigNumber.from(70_000)
const AGGREGATION_V3_STEP_OVERHEAD_GAS = BigNumber.from(25_000)
const AGGREGATION_CURVE_STEP_GAS = BigNumber.from(220_000)
const AGGREGATION_TRANSMUTER_GAS = BigNumber.from(95_000)

interface AggregationState {
  transmuterEnabled: boolean
  transmuterUsdcBalance: BigNumber
}

export interface CurveAggregationTemplate {
  label: string
  curve: GnosisCurveRouteSpec
  preTransmute?: GnosisTransmuteDirection
  postTransmute?: GnosisTransmuteDirection
}

export interface GnosisCurveV3MixedRouteTemplate {
  direction: 'curve-to-v3' | 'v3-to-curve'
  curveTemplate: CurveAggregationTemplate
  v3TokenIn: string
  v3TokenOut: string
  label: string
}

interface AggregationLegQuote {
  label: string
  amountIn: BigNumber
  amountOut: BigNumber
  gasEstimate: BigNumber
  steps: GnosisAggregationStep[]
}

interface AggregationCandidate {
  legs: AggregationLegQuote[]
  totalOut: BigNumber
  gasEstimate: BigNumber
  routeString: string
}

function isSameAddress(a: string | undefined, b: string): boolean {
  return Boolean(a && a.toLowerCase() === b.toLowerCase())
}

async function readAggregationState(provider: JsonRpcProvider): Promise<AggregationState> {
  const calls: ReadCall[] = [
    {
      target: GNOSIS_USDC_TRANSMUTER_ADDRESS,
      allowFailure: true,
      callData: usdcTransmuterInterface.encodeFunctionData('isEnabled'),
    },
    {
      target: GNOSIS_USDC,
      allowFailure: true,
      callData: erc20BalanceInterface.encodeFunctionData('balanceOf', [GNOSIS_USDC_TRANSMUTER_ADDRESS]),
    },
  ]
  let enabledResult: { success: boolean; returnData: string } | undefined
  let balanceResult: { success: boolean; returnData: string } | undefined
  try {
    ;[enabledResult, balanceResult] = await getMulticall(provider).callStatic.aggregate3(calls)
  } catch {
    return { transmuterEnabled: false, transmuterUsdcBalance: BigNumber.from(0) }
  }

  let transmuterEnabled = false
  if (enabledResult?.success) {
    try {
      transmuterEnabled = Boolean(
        usdcTransmuterInterface.decodeFunctionResult('isEnabled', enabledResult.returnData)[0],
      )
    } catch {
      transmuterEnabled = false
    }
  }

  let transmuterUsdcBalance = BigNumber.from(0)
  if (balanceResult?.success) {
    try {
      transmuterUsdcBalance = BigNumber.from(
        erc20BalanceInterface.decodeFunctionResult('balanceOf', balanceResult.returnData)[0],
      )
    } catch {
      transmuterUsdcBalance = BigNumber.from(0)
    }
  }
  return { transmuterEnabled, transmuterUsdcBalance }
}

function buildCurveAggregationTemplate(args: {
  tokenIn: string
  tokenOut: string
}): CurveAggregationTemplate | undefined {
  const direct = getGnosisCurveDirectPoolRoute({ tokenIn: args.tokenIn, tokenOut: args.tokenOut })
  if (direct) {
    return { label: direct.label, curve: direct }
  }

  const eureUsd = buildEureUsdCurveAggregationTemplate(args)
  if (eureUsd) {
    return eureUsd
  }

  if (isSameAddress(args.tokenIn, GNOSIS_USDCE)) {
    const curve = getGnosisCurveX3PoolRoute({ tokenIn: GNOSIS_USDC, tokenOut: args.tokenOut })
    if (curve) {
      return { label: 'USDC.e->USDC + Curve x3pool', curve, preTransmute: GnosisTransmuteDirection.UsdceToUsdc }
    }
  }

  if (isSameAddress(args.tokenOut, GNOSIS_USDCE)) {
    const curve = getGnosisCurveX3PoolRoute({ tokenIn: args.tokenIn, tokenOut: GNOSIS_USDC })
    if (curve) {
      return { label: 'Curve x3pool + USDC->USDC.e', curve, postTransmute: GnosisTransmuteDirection.UsdcToUsdce }
    }
  }

  return undefined
}

function buildEureUsdCurveAggregationTemplate(args: {
  tokenIn: string
  tokenOut: string
}): CurveAggregationTemplate | undefined {
  const direct = getGnosisCurveEureUsdRoute({ tokenIn: args.tokenIn, tokenOut: args.tokenOut })
  if (direct) {
    return { label: direct.label, curve: direct }
  }

  if (isSameAddress(args.tokenIn, GNOSIS_USDCE)) {
    const curve = getGnosisCurveEureUsdRoute({ tokenIn: GNOSIS_USDC, tokenOut: args.tokenOut })
    if (curve) {
      return { label: 'USDC.e->USDC + Curve eureusd', curve, preTransmute: GnosisTransmuteDirection.UsdceToUsdc }
    }
  }

  if (isSameAddress(args.tokenOut, GNOSIS_USDCE)) {
    const curve = getGnosisCurveEureUsdRoute({ tokenIn: args.tokenIn, tokenOut: GNOSIS_USDC })
    if (curve) {
      return { label: 'Curve eureusd + USDC->USDC.e', curve, postTransmute: GnosisTransmuteDirection.UsdcToUsdce }
    }
  }

  return undefined
}

function isGnosisGbpeAddress(address: string | undefined): boolean {
  return isSameAddress(address, GNOSIS_GBPE_V1) || isSameAddress(address, GNOSIS_GBPE_V2)
}

export function getGnosisCurveV3MixedRouteTemplate(args: {
  tokenIn: string
  tokenOut: string
}): GnosisCurveV3MixedRouteTemplate | undefined {
  if (isNativeSentinel(args.tokenIn) || isNativeSentinel(args.tokenOut)) {
    return undefined
  }

  const tokenInIsOsgno = isSameAddress(args.tokenIn, GNOSIS_OSGNO)
  const tokenOutIsOsgno = isSameAddress(args.tokenOut, GNOSIS_OSGNO)
  const tokenInIsGno = isSameAddress(args.tokenIn, GNOSIS_GNO)
  const tokenOutIsGno = isSameAddress(args.tokenOut, GNOSIS_GNO)

  if (tokenInIsOsgno && !tokenOutIsOsgno && !tokenOutIsGno) {
    const curve = getGnosisCurveDirectPoolRoute({ tokenIn: args.tokenIn, tokenOut: GNOSIS_GNO })
    if (!curve) {
      return undefined
    }
    return {
      direction: 'curve-to-v3',
      curveTemplate: { label: 'Curve GNO/osGNO', curve },
      v3TokenIn: GNOSIS_GNO,
      v3TokenOut: args.tokenOut,
      label: 'Curve GNO/osGNO -> Uniswap V3',
    }
  }

  if (tokenOutIsOsgno && !tokenInIsOsgno && !tokenInIsGno) {
    const curve = getGnosisCurveDirectPoolRoute({ tokenIn: GNOSIS_GNO, tokenOut: args.tokenOut })
    if (!curve) {
      return undefined
    }
    return {
      direction: 'v3-to-curve',
      curveTemplate: { label: 'Curve GNO/osGNO', curve },
      v3TokenIn: args.tokenIn,
      v3TokenOut: GNOSIS_GNO,
      label: 'Uniswap V3 -> Curve GNO/osGNO',
    }
  }

  if (!isGnosisGbpeAddress(args.tokenIn) && isSameAddress(args.tokenOut, GNOSIS_GBPE_V1)) {
    const curveTemplate = buildEureUsdCurveAggregationTemplate({ tokenIn: args.tokenIn, tokenOut: GNOSIS_EURE_V1 })
    if (!curveTemplate) {
      return undefined
    }
    return {
      direction: 'curve-to-v3',
      curveTemplate,
      v3TokenIn: GNOSIS_EURE_V1,
      v3TokenOut: args.tokenOut,
      label: 'Curve eureusd -> Uniswap V3',
    }
  }

  if (isSameAddress(args.tokenIn, GNOSIS_GBPE_V1) && !isGnosisGbpeAddress(args.tokenOut)) {
    const curveTemplate = buildEureUsdCurveAggregationTemplate({ tokenIn: GNOSIS_EURE_V1, tokenOut: args.tokenOut })
    if (!curveTemplate) {
      return undefined
    }
    return {
      direction: 'v3-to-curve',
      curveTemplate,
      v3TokenIn: args.tokenIn,
      v3TokenOut: GNOSIS_EURE_V1,
      label: 'Uniswap V3 -> Curve eureusd',
    }
  }

  return undefined
}

function buildDirectTransmuterLeg(args: {
  amount: BigNumber
  direction: GnosisTransmuteDirection
}): AggregationLegQuote {
  return {
    label:
      args.direction === GnosisTransmuteDirection.UsdceToUsdc ? 'USDC.e->USDC transmuter' : 'USDC->USDC.e transmuter',
    amountIn: args.amount,
    amountOut: args.amount,
    gasEstimate: AGGREGATION_TRANSMUTER_GAS,
    steps: [
      {
        stepType: GnosisAggregationStepType.Transmute,
        data: encodeGnosisAggregationTransmuteStepData(args.direction),
      },
    ],
  }
}

function buildV3AggregationLeg(quoted: QuotedRoute): AggregationLegQuote {
  return {
    label: 'Uniswap V3',
    amountIn: quoted.amountIn,
    amountOut: quoted.amountOut,
    gasEstimate: quoted.gasEstimate.add(AGGREGATION_V3_STEP_OVERHEAD_GAS),
    steps: [
      {
        stepType: GnosisAggregationStepType.V3,
        data: encodeGnosisAggregationV3StepData({
          path: encodePath({ tokens: quoted.route.tokens, fees: quoted.route.fees, exactOutput: false }),
          amountOutMinimum: 0,
        }),
      },
    ],
  }
}

function buildCurveAggregationLeg(args: {
  template: CurveAggregationTemplate
  amountIn: BigNumber
  amountOut: BigNumber
}): AggregationLegQuote {
  const steps: GnosisAggregationStep[] = []
  let gasEstimate = AGGREGATION_CURVE_STEP_GAS
  if (args.template.preTransmute !== undefined) {
    gasEstimate = gasEstimate.add(AGGREGATION_TRANSMUTER_GAS)
    steps.push({
      stepType: GnosisAggregationStepType.Transmute,
      data: encodeGnosisAggregationTransmuteStepData(args.template.preTransmute),
    })
  }
  steps.push({
    stepType: GnosisAggregationStepType.Curve,
    data: encodeGnosisAggregationCurveStepData({
      route: args.template.curve.route,
      swapParams: args.template.curve.swapParams,
      pools: args.template.curve.pools,
      amountOutMinimum: 0,
    }),
  })
  if (args.template.postTransmute !== undefined) {
    gasEstimate = gasEstimate.add(AGGREGATION_TRANSMUTER_GAS)
    steps.push({
      stepType: GnosisAggregationStepType.Transmute,
      data: encodeGnosisAggregationTransmuteStepData(args.template.postTransmute),
    })
  }

  return {
    label: args.template.label,
    amountIn: args.amountIn,
    amountOut: args.amountOut,
    gasEstimate,
    steps,
  }
}

function curveTemplateCanSpend(args: {
  template: CurveAggregationTemplate
  state: AggregationState
  amount: BigNumber
}): boolean {
  if (
    !args.state.transmuterEnabled &&
    (args.template.preTransmute !== undefined || args.template.postTransmute !== undefined)
  ) {
    return false
  }
  if (args.template.preTransmute === GnosisTransmuteDirection.UsdceToUsdc) {
    return args.state.transmuterUsdcBalance.gte(args.amount)
  }
  return true
}

async function quoteCurveTemplateAmountPairs(args: {
  provider: JsonRpcProvider
  template: CurveAggregationTemplate
  state: AggregationState
  amounts: BigNumber[]
}): Promise<Map<string, AggregationLegQuote>> {
  const spendableAmounts = args.amounts.filter((amount) =>
    curveTemplateCanSpend({ template: args.template, state: args.state, amount }),
  )
  if (!spendableAmounts.length) {
    return new Map()
  }

  const calls: ReadCall[] = spendableAmounts.map((amount) => ({
    target: GNOSIS_CURVE_ROUTER_ADDRESS,
    allowFailure: true,
    callData: curveRouterInterface.encodeFunctionData('get_dy', [
      args.template.curve.route,
      args.template.curve.swapParams,
      amount,
      args.template.curve.pools,
    ]),
  }))
  let results: { success: boolean; returnData: string }[]
  try {
    results = await getMulticall(args.provider).callStatic.aggregate3(calls)
  } catch {
    return new Map()
  }

  const quotedByAmount = new Map<string, AggregationLegQuote>()
  results.forEach((result, index) => {
    const amountIn = spendableAmounts[index]
    if (!amountIn || !result.success) {
      return
    }
    try {
      const amountOut = BigNumber.from(curveRouterInterface.decodeFunctionResult('get_dy', result.returnData)[0])
      if (!amountOut.isZero()) {
        quotedByAmount.set(
          amountIn.toString(),
          buildCurveAggregationLeg({ template: args.template, amountIn, amountOut }),
        )
      }
    } catch {
      // Ignore undecodable Curve quote results.
    }
  })
  return quotedByAmount
}

function buildAggregationCandidate(legs: AggregationLegQuote[]): AggregationCandidate {
  return {
    legs,
    totalOut: legs.reduce((sum, leg) => sum.add(leg.amountOut), BigNumber.from(0)),
    gasEstimate: AGGREGATION_ROUTER_OVERHEAD_GAS.add(
      legs.reduce((sum, leg) => sum.add(leg.gasEstimate), BigNumber.from(0)),
    ),
    routeString: legs.map((leg) => leg.label).join(' + '),
  }
}

const GNOSIS_MIXED_AGGREGATION_V3_ROUTING_HUBS = [...new Set([...GNOSIS_BASE_TOKENS, GNOSIS_GNO, GNOSIS_EURE_V1])]

function buildSerialAggregationLeg(args: {
  label: string
  first: AggregationLegQuote
  second: AggregationLegQuote
}): AggregationLegQuote {
  return {
    label: args.label,
    amountIn: args.first.amountIn,
    amountOut: args.second.amountOut,
    gasEstimate: args.first.gasEstimate.add(args.second.gasEstimate),
    steps: [...args.first.steps, ...args.second.steps],
  }
}

/**
 * Discovers pool edges, annotates with TVL, then runs the hop-tier loop (discover → annotate →
 * buildPoolState → quoteRanked → estimateImpact → viability check) and returns the first viable
 * route, or undefined when no tier yields one.
 *
 * NOTE: `fetchGnosisQuoteInner` runs the same hop-tier/impact logic inline because it also needs
 * the full ranked list for split-fill and handles indicative vs. firm hop-tier slicing. Both paths
 * MUST use the same hop-tier progression (`GNOSIS_ROUTE_HOP_TIERS`) and impact threshold
 * (`GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT`) — update them together.
 */
async function findBestViableV3Route(args: {
  provider: JsonRpcProvider
  tokenIn: string
  tokenOut: string
  amount: BigNumber
  tradeType: TradingApi.TradeType
  routingHubs: string[]
}): Promise<QuotedRoute | undefined> {
  const discoveredPoolEdges = await discoverGnosisPoolGraphEdges({
    provider: args.provider,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    routingHubs: args.routingHubs,
  })
  const poolEdges = await annotateGnosisPoolGraphEdgesWithTvl(discoveredPoolEdges)
  if (!poolEdges.length) {
    return undefined
  }
  const poolStateByKey = buildPoolStateByKey(poolEdges)
  for (const maxHops of GNOSIS_ROUTE_HOP_TIERS) {
    const ranked = await quoteRankedAtHops({
      provider: args.provider,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      poolEdges,
      amount: args.amount,
      tradeType: args.tradeType,
      maxHops,
    })
    const best = ranked[0]
    if (!best) {
      continue
    }
    const impact = estimateRouteImpactPct({ quoted: best, byKey: poolStateByKey, tradeType: args.tradeType })
    if (isGnosisQuotePriceImpactViable(impact)) {
      return best
    }
  }
  return undefined
}

async function quoteBestV3ExactInputForAggregation(args: {
  provider: JsonRpcProvider
  tokenIn: string
  tokenOut: string
  amount: BigNumber
}): Promise<QuotedRoute | undefined> {
  return findBestViableV3Route({
    provider: args.provider,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amount: args.amount,
    tradeType: TradingApi.TradeType.EXACT_INPUT,
    routingHubs: GNOSIS_MIXED_AGGREGATION_V3_ROUTING_HUBS,
  })
}

async function buildCurveV3MixedAggregationCandidate(args: {
  provider: JsonRpcProvider
  amount: BigNumber
  template: GnosisCurveV3MixedRouteTemplate
  aggregationState: AggregationState
}): Promise<AggregationCandidate | undefined> {
  try {
    if (args.template.direction === 'v3-to-curve') {
      const v3Quoted = await quoteBestV3ExactInputForAggregation({
        provider: args.provider,
        tokenIn: args.template.v3TokenIn,
        tokenOut: args.template.v3TokenOut,
        amount: args.amount,
      })
      if (!v3Quoted) {
        return undefined
      }
      const actualV3TokenOut = v3Quoted.route.tokens.at(-1)
      if (
        !actualV3TokenOut ||
        !isSameAddress(v3Quoted.route.tokens[0], args.template.v3TokenIn) ||
        !isSameAddress(actualV3TokenOut, args.template.v3TokenOut)
      ) {
        return undefined
      }
      const curveQuotes = await quoteCurveTemplateAmountPairs({
        provider: args.provider,
        template: args.template.curveTemplate,
        state: args.aggregationState,
        amounts: [v3Quoted.amountOut],
      })
      const curveLeg = curveQuotes.get(v3Quoted.amountOut.toString())
      if (!curveLeg) {
        return undefined
      }
      return buildAggregationCandidate([
        buildSerialAggregationLeg({
          label: args.template.label,
          first: buildV3AggregationLeg(v3Quoted),
          second: curveLeg,
        }),
      ])
    }

    const curveQuotes = await quoteCurveTemplateAmountPairs({
      provider: args.provider,
      template: args.template.curveTemplate,
      state: args.aggregationState,
      amounts: [args.amount],
    })
    const curveLeg = curveQuotes.get(args.amount.toString())
    if (!curveLeg) {
      return undefined
    }
    const v3Quoted = await quoteBestV3ExactInputForAggregation({
      provider: args.provider,
      tokenIn: args.template.v3TokenIn,
      tokenOut: args.template.v3TokenOut,
      amount: curveLeg.amountOut,
    })
    if (!v3Quoted) {
      return undefined
    }
    const actualTokenOut = v3Quoted.route.tokens.at(-1)
    if (
      !actualTokenOut ||
      !isSameAddress(v3Quoted.route.tokens[0], args.template.v3TokenIn) ||
      !isSameAddress(actualTokenOut, args.template.v3TokenOut)
    ) {
      return undefined
    }
    return buildAggregationCandidate([
      buildSerialAggregationLeg({
        label: args.template.label,
        first: curveLeg,
        second: buildV3AggregationLeg(v3Quoted),
      }),
    ])
  } catch (error) {
    logger.warn('fetchGnosisQuote', 'buildCurveV3MixedAggregationCandidate', 'Mixed-route candidate failed', { error })
    return undefined
  }
}

async function buildAggregationSplitCandidate(args: {
  provider: JsonRpcProvider
  amount: BigNumber
  v3: QuotedRoute
  curveTemplate: CurveAggregationTemplate
  aggregationState: AggregationState
}): Promise<AggregationCandidate | undefined> {
  const allocations = enumerateAllocations({
    total: args.amount,
    legs: 2,
    steps: GNOSIS_SPLIT_GRID_STEPS,
    deepestLegIndex: 0,
  })
  const amounts = [...new Set(allocations.flatMap((allocation) => allocation.map((legAmount) => legAmount.toString())))]
    .map((amount) => BigNumber.from(amount))
    .filter((amount) => !amount.isZero())

  let quotedV3: (QuotedRoute | undefined)[]
  let quotedCurve: Map<string, AggregationLegQuote>
  try {
    ;[quotedV3, quotedCurve] = await Promise.all([
      quoteRouteAmountPairs({
        provider: args.provider,
        pairs: amounts.map((amount) => ({ route: args.v3.route, amount })),
        tradeType: TradingApi.TradeType.EXACT_INPUT,
      }),
      quoteCurveTemplateAmountPairs({
        provider: args.provider,
        template: args.curveTemplate,
        state: args.aggregationState,
        amounts,
      }),
    ])
  } catch {
    return undefined
  }
  const v3ByAmount = new Map<string, AggregationLegQuote>()
  quotedV3.forEach((quoted) => {
    if (quoted) {
      v3ByAmount.set(quoted.amountIn.toString(), buildV3AggregationLeg(quoted))
    }
  })

  const best = selectBestSplit({
    allocations,
    outputForLeg: (legIndex, legAmount) =>
      legIndex === 0
        ? v3ByAmount.get(legAmount.toString())?.amountOut
        : quotedCurve.get(legAmount.toString())?.amountOut,
  })
  if (!best || activeLegCount(best.allocation) < 2) {
    return undefined
  }

  const v3Leg = v3ByAmount.get(best.allocation[0]?.toString() ?? '')
  const curveLeg = quotedCurve.get(best.allocation[1]?.toString() ?? '')
  if (!v3Leg || !curveLeg) {
    return undefined
  }
  return buildAggregationCandidate([v3Leg, curveLeg])
}

async function tryBuildAggregationQuote(args: {
  provider: JsonRpcProvider
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean }
  inputToken: string
  outputToken: string
  amount: BigNumber
  bestV3?: QuotedRoute
  v3BaselineOut?: BigNumber
}): Promise<DiscriminatedQuoteResponse | undefined> {
  if (
    args.params.type !== TradingApi.TradeType.EXACT_INPUT ||
    args.params.isUSDQuote ||
    !isGnosisAggregationEnabled()
  ) {
    return undefined
  }

  const directTransmute = getGnosisTransmuteDirection({ tokenIn: args.inputToken, tokenOut: args.outputToken })
  const curveTemplate = buildCurveAggregationTemplate({ tokenIn: args.inputToken, tokenOut: args.outputToken })
  const curveV3MixedTemplate = getGnosisCurveV3MixedRouteTemplate({
    tokenIn: args.inputToken,
    tokenOut: args.outputToken,
  })
  if (directTransmute === undefined && !curveTemplate && !curveV3MixedTemplate) {
    return undefined
  }

  const aggregationState = await readAggregationState(args.provider)
  const candidates: AggregationCandidate[] = []
  if (
    directTransmute !== undefined &&
    aggregationState.transmuterEnabled &&
    (directTransmute !== GnosisTransmuteDirection.UsdceToUsdc ||
      aggregationState.transmuterUsdcBalance.gte(args.amount))
  ) {
    candidates.push(
      buildAggregationCandidate([buildDirectTransmuterLeg({ amount: args.amount, direction: directTransmute })]),
    )
  }

  if (curveTemplate) {
    const quotedCurve = await quoteCurveTemplateAmountPairs({
      provider: args.provider,
      template: curveTemplate,
      state: aggregationState,
      amounts: [args.amount],
    })
    const curveLeg = quotedCurve.get(args.amount.toString())
    if (curveLeg) {
      candidates.push(buildAggregationCandidate([curveLeg]))
    }
    if (args.bestV3) {
      const split = await buildAggregationSplitCandidate({
        provider: args.provider,
        amount: args.amount,
        v3: args.bestV3,
        curveTemplate,
        aggregationState,
      })
      if (split) {
        candidates.push(split)
      }
    }
  }
  if (curveV3MixedTemplate) {
    const mixed = await buildCurveV3MixedAggregationCandidate({
      provider: args.provider,
      amount: args.amount,
      template: curveV3MixedTemplate,
      aggregationState,
    })
    if (mixed) {
      candidates.push(mixed)
    }
  }

  if (!candidates.length) {
    return undefined
  }
  candidates.sort((a, b) => (a.totalOut.gt(b.totalOut) ? -1 : a.totalOut.lt(b.totalOut) ? 1 : 0))
  const best = candidates[0]
  if (!best) {
    return undefined
  }
  const baselineOut = args.v3BaselineOut ?? BigNumber.from(0)
  if (
    !baselineOut.isZero() &&
    !passesAcceptGate({
      splitOutput: best.totalOut,
      singleBestOutput: baselineOut,
      minImprovementBps: GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS,
    })
  ) {
    return undefined
  }

  const slippage = getGnosisSlippageTolerance(args.params)
  const tokenOut = args.outputToken
  const { maximumAmountIn, minimumAmountOut } = getGnosisQuoteSlippageAmounts({
    amountIn: args.amount,
    amountOut: best.totalOut,
    tradeType: TradingApi.TradeType.EXACT_INPUT,
    slippagePercent: slippage,
  })
  const [blockNumber, gasPrice] = await Promise.all([args.provider.getBlockNumber(), args.provider.getGasPrice()])
  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: args.params.swapper,
    input: { token: args.inputToken, amount: args.amount.toString(), maximumAmount: maximumAmountIn.toString() },
    output: {
      token: tokenOut,
      amount: best.totalOut.toString(),
      minimumAmount: minimumAmountOut.toString(),
      recipient: args.params.recipient ?? args.params.swapper,
    },
    tradeType: TradingApi.TradeType.EXACT_INPUT,
    slippage,
    route: [],
    routeString: best.routeString,
    quoteId: GNOSIS_AGGREGATION_QUOTE_ID,
    gasUseEstimate: best.gasEstimate.toString(),
    gasFee: best.gasEstimate.mul(gasPrice).toString(),
    blockNumber: String(blockNumber),
    priceImpact: 0,
    portionBips: 0,
  }
  const aggregationQuote = quote as GnosisAggregationQuote
  aggregationQuote.aggregation = {
    tokenIn: args.inputToken,
    tokenOut,
    legs: best.legs.map(
      (leg): GnosisAggregationLeg => ({
        amountIn: leg.amountIn.toString(),
        steps: leg.steps,
        label: leg.label,
      }),
    ),
  }

  return {
    requestId: 'gnosis-local',
    routing: TradingApi.Routing.CLASSIC,
    permitData: null,
    quote: aggregationQuote,
  } as DiscriminatedQuoteResponse
}

interface ReadCall {
  target: string
  allowFailure: boolean
  callData: string
}

/** Per-hop CREATE2 pool addresses for a route (independent of token decimals). */
function computeRoutePoolAddresses(route: CandidateRoute): string[] {
  const addresses: string[] = []
  for (let i = 0; i < route.fees.length; i++) {
    const a = route.tokens[i] ?? ''
    const b = route.tokens[i + 1] ?? ''
    const fee = route.fees[i] ?? FeeAmount.MEDIUM
    addresses.push(
      computePoolAddress({
        factoryAddress: GNOSIS_V3_FACTORY_ADDRESS,
        tokenA: new Token(UniverseChainId.Gnosis, a, 18),
        tokenB: new Token(UniverseChainId.Gnosis, b, 18),
        fee,
      }),
    )
  }
  return addresses
}

/**
 * Reads everything needed to finalize the chosen route(s) in one Multicall3 call: per-hop pool
 * state (cache-aware) for every leg, metadata for any unknown tokens, and — when an ERC20 input may
 * need it — the Permit2→UniversalRouter allowance. Returns pool state grouped per route so a single
 * (single-route) or multi-leg (split-fill) quote can both be built from one batched read.
 */
async function finalizeRoutes(args: {
  provider: JsonRpcProvider
  routes: CandidateRoute[]
  tokenAddresses: string[]
  permitOwner: string | undefined
  permitToken: string | undefined
}): Promise<{
  metas: Map<string, TokenMeta>
  poolStatesByRoute: PoolState[][]
  permit2Allowance?: { amount: BigNumber; expiration: BigNumber }
}> {
  const { provider, routes, tokenAddresses, permitOwner, permitToken } = args
  const now = Date.now()

  // Pool addresses per route; legs are pool-disjoint and a route's hops are distinct pools, so the
  // union has no duplicates.
  const poolAddressesByRoute = routes.map(computeRoutePoolAddresses)
  const poolAddresses = poolAddressesByRoute.flat()

  const calls: ReadCall[] = []
  const callTags: { kind: 'slot0' | 'liquidity' | 'symbol' | 'decimals' | 'permit2'; key: string }[] = []

  // Pool state for cache misses only.
  const poolNeedsRead = poolAddresses.filter((addr) => {
    const cached = poolStateCache.get(addr.toLowerCase())
    return !cached || now - cached.ts > POOL_STATE_TTL_MS
  })
  for (const addr of poolNeedsRead) {
    calls.push({ target: addr, allowFailure: false, callData: poolInterface.encodeFunctionData('slot0') })
    callTags.push({ kind: 'slot0', key: addr.toLowerCase() })
    calls.push({ target: addr, allowFailure: false, callData: poolInterface.encodeFunctionData('liquidity') })
    callTags.push({ kind: 'liquidity', key: addr.toLowerCase() })
  }

  // Metadata for unknown tokens.
  const unknownTokens = [...new Set(tokenAddresses.map((a) => a.toLowerCase()))].filter(
    (a) => !KNOWN_TOKENS[a] && !tokenMetaCache.has(a),
  )
  for (const addr of unknownTokens) {
    calls.push({ target: addr, allowFailure: true, callData: erc20MetaInterface.encodeFunctionData('symbol') })
    callTags.push({ kind: 'symbol', key: addr })
    calls.push({ target: addr, allowFailure: true, callData: erc20MetaInterface.encodeFunctionData('decimals') })
    callTags.push({ kind: 'decimals', key: addr })
  }

  // Permit2 → UniversalRouter allowance (only when relevant).
  const wantsPermit = Boolean(permitOwner && permitToken)
  if (permitOwner && permitToken) {
    calls.push({
      target: PERMIT2_ADDRESS,
      allowFailure: true,
      callData: permit2Interface.encodeFunctionData('allowance', [
        permitOwner,
        permitToken,
        GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
      ]),
    })
    callTags.push({ kind: 'permit2', key: permitToken.toLowerCase() })
  }

  const results = calls.length ? await getMulticall(provider).callStatic.aggregate3(calls) : []

  const pendingSymbol = new Map<string, string>()
  const pendingDecimals = new Map<string, number>()
  let permit2Allowance: { amount: BigNumber; expiration: BigNumber } | undefined

  results.forEach((result, i) => {
    const tag = callTags[i]
    if (!tag) {
      return
    }
    if (tag.kind === 'slot0' && result.success) {
      const decoded = poolInterface.decodeFunctionResult('slot0', result.returnData)
      const prev = poolStateCache.get(tag.key)?.state
      poolStateCache.set(tag.key, {
        ts: now,
        state: {
          sqrtPriceX96: BigNumber.from(decoded[0]),
          tick: Number(decoded[1]),
          liquidity: prev?.liquidity ?? BigNumber.from(0),
        },
      })
    } else if (tag.kind === 'liquidity' && result.success) {
      const liquidity = BigNumber.from(poolInterface.decodeFunctionResult('liquidity', result.returnData)[0])
      const existing = poolStateCache.get(tag.key)
      if (existing) {
        existing.state.liquidity = liquidity
        existing.ts = now
      }
    } else if (tag.kind === 'symbol' && result.success) {
      try {
        pendingSymbol.set(tag.key, erc20MetaInterface.decodeFunctionResult('symbol', result.returnData)[0])
      } catch {
        /* non-standard symbol */
      }
    } else if (tag.kind === 'decimals' && result.success) {
      pendingDecimals.set(tag.key, Number(erc20MetaInterface.decodeFunctionResult('decimals', result.returnData)[0]))
    } else if (tag.kind === 'permit2' && result.success) {
      const decoded = permit2Interface.decodeFunctionResult('allowance', result.returnData)
      permit2Allowance = { amount: BigNumber.from(decoded[0]), expiration: BigNumber.from(decoded[1]) }
    }
  })

  // Commit newly read token metadata to the cache. Skip tokens whose decimals couldn't be
  // read rather than defaulting to 18 (which would misscale 6-decimal tokens).
  for (const addr of unknownTokens) {
    const decimals = pendingDecimals.get(addr)
    if (decimals === undefined) {
      throw new Error(`Unable to read decimals for token ${addr} on Gnosis`)
    }
    tokenMetaCache.set(addr, { address: addr, symbol: pendingSymbol.get(addr) ?? 'UNKNOWN', decimals })
  }

  const metas = new Map<string, TokenMeta>()
  for (const raw of tokenAddresses) {
    const key = raw.toLowerCase()
    const known = KNOWN_TOKENS[key]
    const meta = known ? { address: raw, symbol: known.symbol, decimals: known.decimals } : tokenMetaCache.get(key)
    if (!meta) {
      throw new Error(`Missing token metadata for ${raw} on Gnosis`)
    }
    metas.set(key, { ...meta, address: raw })
  }

  const poolStatesByRoute = poolAddressesByRoute.map((addresses) =>
    addresses.map((addr) => {
      const cached = poolStateCache.get(addr.toLowerCase())
      if (!cached) {
        throw new Error(`Missing pool state for ${addr} on Gnosis`)
      }
      return cached.state
    }),
  )

  return { metas, poolStatesByRoute, permit2Allowance: wantsPermit ? permit2Allowance : undefined }
}

function toTokenInRoute(meta: TokenMeta): TradingApi.TokenInRoute {
  return { address: meta.address, chainId: GNOSIS_CHAIN_ID, symbol: meta.symbol, decimals: String(meta.decimals) }
}

/**
 * Builds the per-hop V3PoolInRoute array for a single (sub-)route. The universal-router-sdk reads
 * only the first hop's `amountIn` and the last hop's `amountOut` per sub-route; intermediate
 * boundary amounts are unused. Shared by the single-route and split-fill (one sub-route per leg)
 * quote paths.
 */
function buildSubRoute(args: {
  route: CandidateRoute
  amountIn: BigNumber
  amountOut: BigNumber
  metas: Map<string, TokenMeta>
  poolStates: PoolState[]
}): TradingApi.V3PoolInRoute[] {
  const { route, amountIn, amountOut, metas, poolStates } = args
  return route.fees.map((fee, i) => {
    const metaIn = metas.get((route.tokens[i] ?? '').toLowerCase())
    const metaOut = metas.get((route.tokens[i + 1] ?? '').toLowerCase())
    if (!metaIn || !metaOut) {
      throw new Error('Missing token metadata while building Gnosis route')
    }
    const state = poolStates[i]
    if (!state) {
      throw new Error('Missing pool state while building Gnosis route')
    }
    const poolAddress = computePoolAddress({
      factoryAddress: GNOSIS_V3_FACTORY_ADDRESS,
      tokenA: new Token(UniverseChainId.Gnosis, metaIn.address, metaIn.decimals),
      tokenB: new Token(UniverseChainId.Gnosis, metaOut.address, metaOut.decimals),
      fee,
    })
    const isFirst = i === 0
    const isLast = i === route.fees.length - 1
    return {
      type: 'v3-pool',
      address: poolAddress,
      tokenIn: toTokenInRoute(metaIn),
      tokenOut: toTokenInRoute(metaOut),
      fee: String(fee),
      liquidity: state.liquidity.toString(),
      sqrtRatioX96: state.sqrtPriceX96.toString(),
      tickCurrent: String(state.tick),
      amountIn: isFirst ? amountIn.toString() : '0',
      amountOut: isLast ? amountOut.toString() : '0',
    }
  })
}

export interface FetchGnosisQuoteOptions {
  /** Indicative (keystroke) quotes skip pool-state reads, price impact, gas and permit lookups. */
  indicative?: boolean
}

const SDAI_ADAPTER_GAS_ESTIMATE = BigNumber.from(180_000)

async function fetchGnosisSdaiAdapterQuote(args: {
  provider: JsonRpcProvider
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean }
  tradeType: TradingApi.TradeType
  amount: BigNumber
  indicative: boolean
}): Promise<DiscriminatedQuoteResponse | undefined> {
  const { provider, params, tradeType, amount, indicative } = args
  const direction = getGnosisSdaiAdapterDirection({ tokenIn: params.tokenIn, tokenOut: params.tokenOut })
  if (!direction) {
    return undefined
  }

  if (tradeType === TradingApi.TradeType.EXACT_OUTPUT) {
    throw new Error('Exact-output Gnosis sDAI adapter swaps are not supported')
  }

  const previewFunction = direction === GnosisSdaiAdapterDirection.AssetToSdai ? 'previewDeposit' : 'previewRedeem'
  const result = await provider.call({
    to: GNOSIS_SDAI,
    data: sdaiPreviewInterface.encodeFunctionData(previewFunction, [amount]),
  })
  const quotedAmount = BigNumber.from(sdaiPreviewInterface.decodeFunctionResult(previewFunction, result)[0])
  if (quotedAmount.isZero()) {
    throw new Error(`No Gnosis sDAI adapter quote found for ${params.tokenIn} -> ${params.tokenOut}`)
  }

  const amountIn = amount
  const amountOut = quotedAmount
  const recipient = params.recipient ?? params.swapper
  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: params.tokenIn, amount: amountIn.toString() },
    output: { token: params.tokenOut, amount: amountOut.toString(), recipient },
    tradeType,
    slippage: getGnosisSlippageTolerance(params),
    route: [],
    routeString: 'sDAI adapter',
    quoteId: GNOSIS_SDAI_ADAPTER_QUOTE_ID,
    gasUseEstimate: SDAI_ADAPTER_GAS_ESTIMATE.toString(),
    priceImpact: 0,
    portionBips: 0,
  }

  if (!indicative) {
    const [blockNumber, gasPrice] = await Promise.all([provider.getBlockNumber(), provider.getGasPrice()])
    quote.blockNumber = String(blockNumber)
    quote.gasFee = SDAI_ADAPTER_GAS_ESTIMATE.mul(gasPrice).toString()
  }

  return {
    requestId: GNOSIS_SDAI_ADAPTER_QUOTE_ID,
    routing: TradingApi.Routing.CLASSIC,
    permitData: null,
    quote,
  } as DiscriminatedQuoteResponse
}

/**
 * Client-side Gnosis V3 quote provider conforming to `TradingApiClient['fetchQuote']`.
 * Quotes candidate routes via QuoterV2 (batched through Multicall3) and returns a CLASSIC
 * quote the existing swap pipeline consumes unchanged.
 */
export const fetchGnosisQuote: (
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean },
  opts?: FetchGnosisQuoteOptions,
) => Promise<DiscriminatedQuoteResponse> = async (params, opts) => {
  const indicative = opts?.indicative ?? false
  return withTimeout({
    promise: fetchGnosisQuoteInner(params, indicative),
    ms: indicative ? GNOSIS_INDICATIVE_QUOTE_TIMEOUT_MS : GNOSIS_QUOTE_TIMEOUT_MS,
    label: indicative ? 'indicative quote' : 'quote',
  })
}

async function previewSdaiConversion(args: {
  provider: JsonRpcProvider
  fn: 'previewDeposit' | 'previewRedeem'
  amount: BigNumber
}): Promise<BigNumber> {
  const { provider, fn, amount } = args
  const result = await provider.call({ to: GNOSIS_SDAI, data: sdaiPreviewInterface.encodeFunctionData(fn, [amount]) })
  return BigNumber.from(sdaiPreviewInterface.decodeFunctionResult(fn, result)[0])
}

/** A firm zap quote must execute as a single v3 path (the contract does not split). */
function isSingleLegV3Route(route: TradingApi.ClassicQuote['route'] | undefined): boolean {
  return Array.isArray(route) && route.length === 1 && Array.isArray(route[0]) && route[0].length >= 1
}

function buildGnosisZapQuoteResponse(args: {
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean }
  indicative: boolean
  inputToken: string
  outputToken: string
  inputAmount: BigNumber
  outputAmount: BigNumber
  subQuote: TradingApi.ClassicQuote
}): DiscriminatedQuoteResponse {
  const { params, indicative, inputToken, outputToken, inputAmount, outputAmount, subQuote } = args
  const subGasUseEstimate = BigNumber.from(subQuote.gasUseEstimate ?? '0')
  const gasUseEstimate = subGasUseEstimate.add(GNOSIS_SDAI_ZAP_ADAPTER_GAS)
  const gasFee = subQuote.gasFee
    ? subGasUseEstimate.isZero()
      ? BigNumber.from(subQuote.gasFee)
      : BigNumber.from(subQuote.gasFee).add(
          BigNumber.from(subQuote.gasFee).mul(GNOSIS_SDAI_ZAP_ADAPTER_GAS).div(subGasUseEstimate),
        )
    : undefined
  const recipient = params.recipient ?? params.swapper
  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: inputToken, amount: inputAmount.toString() },
    output: { token: outputToken, amount: outputAmount.toString(), recipient },
    tradeType: params.type,
    slippage: getGnosisSlippageTolerance(params),
    route: indicative ? [] : (subQuote.route ?? []),
    routeString: subQuote.routeString ? `sDAI-zap: ${subQuote.routeString}` : 'sDAI zap',
    quoteId: GNOSIS_SDAI_ZAP_QUOTE_ID,
    gasUseEstimate: gasUseEstimate.toString(),
    ...(gasFee ? { gasFee: gasFee.toString() } : {}),
    ...(subQuote.blockNumber ? { blockNumber: subQuote.blockNumber } : {}),
    priceImpact: subQuote.priceImpact ?? 0,
    portionBips: 0,
  }
  return {
    requestId: 'gnosis-local',
    routing: TradingApi.Routing.CLASSIC,
    permitData: null,
    quote,
  } as DiscriminatedQuoteResponse
}

/**
 * Produces a zap quote (adapter + single deep v3 path) for an eligible WXDAI/xDAI <-> counterparty
 * swap by quoting the sDAI-rooted sub-problem with the existing v3 machinery and wrapping it with the
 * sDAI vault conversion. Returns undefined if no usable sub-route exists, so the caller can fall back
 * to the direct v3 quote. The sub-quote runs with the placeholder swapper so it skips permit lookups
 * (zap execution uses a plain ERC20 approval, not Permit2 -> UniversalRouter).
 */
async function tryFetchGnosisZapQuote(args: {
  provider: JsonRpcProvider
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean }
  indicative: boolean
  direction: GnosisSdaiZapDirection
}): Promise<DiscriminatedQuoteResponse | undefined> {
  const { provider, params, indicative, direction } = args
  const amount = BigNumber.from(params.amount)
  const inputToken = params.tokenIn
  const outputToken = params.tokenOut

  try {
    if (direction === GnosisSdaiZapDirection.DepositAndSwap) {
      const sharesIn = await previewSdaiConversion({ provider, fn: 'previewDeposit', amount })
      if (sharesIn.isZero()) {
        return undefined
      }
      const sub = await fetchGnosisQuoteInner(
        {
          ...params,
          tokenIn: GNOSIS_SDAI,
          tokenOut: outputToken,
          amount: sharesIn.toString(),
          swapper: UNCONNECTED_SWAPPER,
        },
        indicative,
      )
      const subQuote = sub.quote as TradingApi.ClassicQuote
      const outputAmount = BigNumber.from(subQuote.output?.amount ?? '0')
      if (outputAmount.isZero() || (!indicative && !isSingleLegV3Route(subQuote.route))) {
        return undefined
      }
      return buildGnosisZapQuoteResponse({
        params,
        indicative,
        inputToken,
        outputToken,
        inputAmount: amount,
        outputAmount,
        subQuote,
      })
    }

    const sub = await fetchGnosisQuoteInner(
      {
        ...params,
        tokenIn: inputToken,
        tokenOut: GNOSIS_SDAI,
        amount: amount.toString(),
        swapper: UNCONNECTED_SWAPPER,
      },
      indicative,
    )
    const subQuote = sub.quote as TradingApi.ClassicQuote
    const shares = BigNumber.from(subQuote.output?.amount ?? '0')
    if (shares.isZero() || (!indicative && !isSingleLegV3Route(subQuote.route))) {
      return undefined
    }
    const outputAmount = await previewSdaiConversion({ provider, fn: 'previewRedeem', amount: shares })
    if (outputAmount.isZero()) {
      return undefined
    }
    return buildGnosisZapQuoteResponse({
      params,
      indicative,
      inputToken,
      outputToken,
      inputAmount: amount,
      outputAmount,
      subQuote,
    })
  } catch {
    return undefined
  }
}

function getClassicQuoteOutputAmount(response: DiscriminatedQuoteResponse | undefined): BigNumber | undefined {
  const quote = response?.quote as TradingApi.ClassicQuote | undefined
  if (!quote || quote.tradeType !== TradingApi.TradeType.EXACT_INPUT) {
    return undefined
  }

  const amount = quote.output?.amount
  if (!amount) {
    return undefined
  }

  try {
    return BigNumber.from(amount)
  } catch {
    return undefined
  }
}

function selectBestExactInputAlternativeQuote(args: {
  baselineOut?: BigNumber
  alternatives: readonly (DiscriminatedQuoteResponse | undefined)[]
}): DiscriminatedQuoteResponse | undefined {
  let best: { response: DiscriminatedQuoteResponse; amountOut: BigNumber } | undefined

  for (const response of args.alternatives) {
    const amountOut = getClassicQuoteOutputAmount(response)
    if (!response || !amountOut) {
      continue
    }
    if (!best || amountOut.gt(best.amountOut)) {
      best = { response, amountOut }
    }
  }

  if (!best) {
    return undefined
  }
  if (
    args.baselineOut &&
    !args.baselineOut.isZero() &&
    !passesAcceptGate({
      splitOutput: best.amountOut,
      singleBestOutput: args.baselineOut,
      minImprovementBps: GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS,
    })
  ) {
    return undefined
  }

  return best.response
}

async function fetchGnosisQuoteInner(
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean },
  indicative: boolean,
): Promise<DiscriminatedQuoteResponse> {
  const provider = getGnosisProvider()
  const tradeType = params.type
  const amount = BigNumber.from(params.amount)

  // Map native xDAI to WXDAI for routing/quoting, but remember it for the swap build.
  const nativeIn = isNativeSentinel(params.tokenIn)
  const nativeOut = isNativeSentinel(params.tokenOut)
  const resolvedIn = nativeIn ? GNOSIS_WXDAI : params.tokenIn
  const resolvedOut = nativeOut ? GNOSIS_WXDAI : params.tokenOut
  // The swap pipeline detects native via the zero/eee sentinel on the quote's input/output
  // token, while the route pools stay denominated in the wrapped (WXDAI) tokens.
  const inputToken = nativeIn ? params.tokenIn : resolvedIn
  const outputToken = nativeOut ? params.tokenOut : resolvedOut

  const sdaiAdapterQuote = await fetchGnosisSdaiAdapterQuote({ provider, params, tradeType, amount, indicative })
  if (sdaiAdapterQuote) {
    return sdaiAdapterQuote
  }

  // WXDAI/xDAI <-> token: lazily probe the sDAI zap (adapter + v3 path) as an alternative route.
  // The zap is selected only after it is compared against the v3/aggregation market quote.
  const zapDirection = getGnosisSdaiZapEligibility({ tokenIn: params.tokenIn, tokenOut: params.tokenOut, tradeType })
  let zapQuotePromise: Promise<DiscriminatedQuoteResponse | undefined> | undefined
  const getZapQuote = (): Promise<DiscriminatedQuoteResponse | undefined> => {
    if (!zapDirection) {
      return Promise.resolve(undefined)
    }
    zapQuotePromise ??= tryFetchGnosisZapQuote({ provider, params, indicative, direction: zapDirection })
    return zapQuotePromise
  }

  const discoveredPoolEdges = await discoverGnosisPoolGraphEdges({
    provider,
    tokenIn: resolvedIn,
    tokenOut: resolvedOut,
  })
  const poolEdges = await annotateGnosisPoolGraphEdgesWithTvl(discoveredPoolEdges)
  if (!poolEdges.length) {
    const [aggregationQuote, zapQuote] = await Promise.all([
      tryBuildAggregationQuote({ provider, params, inputToken, outputToken, amount }),
      getZapQuote(),
    ])
    const alternativeQuote = selectBestExactInputAlternativeQuote({ alternatives: [aggregationQuote, zapQuote] })
    if (alternativeQuote) {
      return alternativeQuote
    }
    throw new Error(`No initialized Gnosis V3 pools found for ${params.tokenIn} -> ${params.tokenOut}`)
  }
  const poolStateByKey = buildPoolStateByKey(poolEdges)

  // Expand the hop limit only as needed: quote the cheapest (fewest-hop) candidate set first and stop
  // as soon as its best route is viable; widen to longer routes only when shorter ones are not (e.g. a
  // deep cluster-crossing path needs >3 hops). Indicative quotes use only the first tier to keep
  // keystroke latency flat. quoteRankedAtHops keeps the preferred-then-fallback (TVL) behavior per tier;
  // the firm path re-checks viability with freshly read pool state before emitting a quote.
  const hopTiers = indicative ? GNOSIS_ROUTE_HOP_TIERS.slice(0, 1) : GNOSIS_ROUTE_HOP_TIERS
  let ranked: QuotedRoute[] = []
  let best: QuotedRoute | undefined
  let bestImpact = 0
  for (const maxHops of hopTiers) {
    ranked = await quoteRankedAtHops({
      provider,
      tokenIn: resolvedIn,
      tokenOut: resolvedOut,
      poolEdges,
      amount,
      tradeType,
      maxHops,
    })
    best = ranked[0]
    if (!best) {
      continue
    }
    bestImpact = estimateRouteImpactPct({ quoted: best, byKey: poolStateByKey, tradeType })
    if (isGnosisQuotePriceImpactViable(bestImpact)) {
      break
    }
  }

  if (!best) {
    const [aggregationQuote, zapQuote] = await Promise.all([
      tryBuildAggregationQuote({ provider, params, inputToken, outputToken, amount }),
      getZapQuote(),
    ])
    const alternativeQuote = selectBestExactInputAlternativeQuote({ alternatives: [aggregationQuote, zapQuote] })
    if (alternativeQuote) {
      return alternativeQuote
    }
    throw new Error(`No Gnosis V3 route found for ${params.tokenIn} -> ${params.tokenOut}`)
  }

  // Indicative quotes only need input/output amounts; skip all the extra reads. Apply the same
  // absurd-quote guard as the firm path here too, using the cheap discovery-state impact estimate,
  // so a thin/over-cap route doesn't flash a phantom output while typing then get rejected on commit.
  if (indicative) {
    assertGnosisQuoteViable({ impact: bestImpact, params })
    const quote: TradingApi.ClassicQuote = {
      chainId: GNOSIS_CHAIN_ID,
      swapper: params.swapper,
      input: { token: inputToken, amount: best.amountIn.toString() },
      output: { token: outputToken, amount: best.amountOut.toString(), recipient: params.recipient ?? params.swapper },
      tradeType,
      slippage: getGnosisSlippageTolerance(params),
      route: [],
      routeString: '',
      quoteId: 'gnosis-local',
      gasUseEstimate: best.gasEstimate.toString(),
      priceImpact: bestImpact,
      portionBips: 0,
    }
    return {
      requestId: 'gnosis-local',
      routing: TradingApi.Routing.CLASSIC,
      permitData: null,
      quote,
    } as DiscriminatedQuoteResponse
  }

  // A permit (Permit2 → UniversalRouter) only applies to ERC20 inputs from a real wallet.
  const permitRelevant =
    !nativeIn &&
    !params.isUSDQuote &&
    Boolean(params.swapper) &&
    params.swapper.toLowerCase() !== UNCONNECTED_SWAPPER.toLowerCase() &&
    params.swapper.toLowerCase() !== ZERO_ADDRESS
  const executionInputToken = best.route.tokens[0] ?? resolvedIn

  // Either the accepted split's legs or the single best route as a one-leg list (the latter is
  // byte-identical to the pre-split single-route quote).
  const legs = await resolveQuoteLegs({ provider, ranked, best, bestImpactPct: bestImpact, amount, tradeType, params })

  const allTokenAddresses = [...new Set(legs.flatMap((leg) => leg.route.tokens))]
  const totalAmountIn = legs.reduce((sum, leg) => sum.add(leg.amountIn), BigNumber.from(0))
  const totalAmountOut = legs.reduce((sum, leg) => sum.add(leg.amountOut), BigNumber.from(0))
  const totalGasEstimate = legs.reduce((sum, leg) => sum.add(leg.gasEstimate), BigNumber.from(0))

  const [aggregationQuote, zapQuote] = await Promise.all([
    tryBuildAggregationQuote({
      provider,
      params,
      inputToken,
      outputToken,
      amount,
      bestV3: best,
      v3BaselineOut: totalAmountOut,
    }),
    getZapQuote(),
  ])
  const alternativeQuote = selectBestExactInputAlternativeQuote({
    baselineOut: totalAmountOut,
    alternatives: [aggregationQuote, zapQuote],
  })
  if (alternativeQuote) {
    return alternativeQuote
  }

  const slippage = getGnosisSlippageTolerance(params)
  const { maximumAmountIn, minimumAmountOut } = getGnosisQuoteSlippageAmounts({
    amountIn: totalAmountIn,
    amountOut: totalAmountOut,
    tradeType,
    slippagePercent: slippage,
  })

  const [{ metas, poolStatesByRoute, permit2Allowance }, blockNumber, gasPrice] = await Promise.all([
    finalizeRoutes({
      provider,
      routes: legs.map((leg) => leg.route),
      tokenAddresses: allTokenAddresses,
      permitOwner: permitRelevant ? params.swapper : undefined,
      permitToken: permitRelevant ? executionInputToken : undefined,
    }),
    provider.getBlockNumber(),
    provider.getGasPrice(),
  ])

  // One sub-route per leg; the universal-router-sdk consumes the multi-sub-route shape natively.
  const route: TradingApi.V3PoolInRoute[][] = legs.map((leg, legIndex) =>
    buildSubRoute({
      route: leg.route,
      amountIn: leg.amountIn,
      amountOut: leg.amountOut,
      metas,
      poolStates: poolStatesByRoute[legIndex] ?? [],
    }),
  )

  // Input-weighted across legs; reduces to the single route's impact for the common one-leg case.
  const priceImpact = computeAggregatePriceImpact({ legs, poolStatesByRoute, metas, tradeType, totalAmountIn })
  // Reject an absurd quote (only path runs through a near-empty pool) instead of surfacing it.
  assertGnosisQuoteViable({ impact: priceImpact, params })
  const gasFee = totalGasEstimate.mul(gasPrice).toString()

  const routeString = legs
    .map((leg) =>
      leg.route.fees
        .map((fee, i) => `${i === 0 ? leg.route.tokens[i] : ''}-[${fee}]-${leg.route.tokens[i + 1]}`)
        .join(''),
    )
    .join(' + ')

  // Build the Permit2 → UniversalRouter approval tx when the current allowance is missing/expired.
  const permitTransaction = buildPermitTransactionIfNeeded({
    permitRelevant,
    permit2Allowance,
    swapper: params.swapper,
    token: executionInputToken,
    requiredAmount: maximumAmountIn,
  })

  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: inputToken, amount: totalAmountIn.toString(), maximumAmount: maximumAmountIn.toString() },
    output: {
      token: outputToken,
      amount: totalAmountOut.toString(),
      minimumAmount: minimumAmountOut.toString(),
      recipient: params.recipient ?? params.swapper,
    },
    tradeType,
    slippage,
    route,
    routeString,
    quoteId: 'gnosis-local',
    gasUseEstimate: totalGasEstimate.toString(),
    gasFee,
    blockNumber: String(blockNumber),
    priceImpact,
    portionBips: 0,
  }

  return {
    requestId: 'gnosis-local',
    routing: TradingApi.Routing.CLASSIC,
    permitData: null,
    ...(permitTransaction
      ? {
          permitTransaction: {
            ...permitTransaction,
            from: params.swapper,
            chainId: UniverseChainId.Gnosis,
            value: '0x0',
          },
          permitGasFee: BigNumber.from(PERMIT2_APPROVE_GAS).mul(gasPrice).toString(),
        }
      : {}),
    quote,
  } as DiscriminatedQuoteResponse
}

/** Computes real price impact for one (sub-)route from its pool spot prices vs the execution price. */
function computeRoutePriceImpact(args: {
  quoted: QuotedRoute
  metas: Map<string, TokenMeta>
  poolStates: PoolState[]
  tradeType: TradingApi.TradeType
}): number {
  const { quoted, metas, poolStates, tradeType } = args
  try {
    const tokenOf = (addr: string): Token => {
      const meta = metas.get(addr.toLowerCase())
      if (!meta) {
        throw new Error(`Missing meta for ${addr}`)
      }
      return new Token(UniverseChainId.Gnosis, meta.address, meta.decimals, meta.symbol)
    }
    const pools = quoted.route.fees.map((fee, i) => {
      const state = poolStates[i]
      if (!state) {
        throw new Error('Missing pool state')
      }
      return new Pool(
        tokenOf(quoted.route.tokens[i] ?? ''),
        tokenOf(quoted.route.tokens[i + 1] ?? ''),
        fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick,
      )
    })
    const currencyIn = tokenOf(quoted.route.tokens[0] ?? '')
    const currencyOut = tokenOf(quoted.route.tokens[quoted.route.tokens.length - 1] ?? '')
    const route = new Route(pools, currencyIn, currencyOut)
    const trade = Trade.createUncheckedTrade({
      route,
      inputAmount: CurrencyAmount.fromRawAmount(currencyIn, quoted.amountIn.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(currencyOut, quoted.amountOut.toString()),
      tradeType: tradeType === TradingApi.TradeType.EXACT_OUTPUT ? 1 : 0,
    })
    // classic.ts reads priceImpact as a percent number (e.g. 2.5 → 2.5%).
    return Number(trade.priceImpact.toFixed(3))
  } catch {
    return 0
  }
}

/**
 * A quote is viable only when its price impact stays below the absurd-quote ceiling. A ~100% impact
 * means the only available path runs through a near-empty pool and the output is garbage (e.g. 10
 * WETH -> 0.000133 WXDAI); such a quote is rejected rather than surfaced. When impact cannot be
 * computed it is reported as 0, so this never rejects a quote whose impact is merely unknown.
 */
export function isGnosisQuotePriceImpactViable(priceImpact: number): boolean {
  return priceImpact < GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT
}

/** Rejects an absurd quote (impact at/above the ceiling) with a single, consistent error message. */
function assertGnosisQuoteViable(args: { impact: number; params: TradingApi.QuoteRequest }): void {
  if (!isGnosisQuotePriceImpactViable(args.impact)) {
    throw new Error(
      `No viable Gnosis V3 route for ${args.params.tokenIn} -> ${args.params.tokenOut}: price impact ${args.impact}% exceeds ${GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT}%`,
    )
  }
}

/** Input-weighted average of per-leg price impact; reduces to the single route's impact at one leg. */
function computeAggregatePriceImpact(args: {
  legs: QuotedRoute[]
  poolStatesByRoute: PoolState[][]
  metas: Map<string, TokenMeta>
  tradeType: TradingApi.TradeType
  totalAmountIn: BigNumber
}): number {
  const { legs, poolStatesByRoute, metas, tradeType, totalAmountIn } = args
  if (totalAmountIn.isZero()) {
    return 0
  }
  let weighted = 0
  legs.forEach((leg, i) => {
    const impact = computeRoutePriceImpact({ quoted: leg, metas, poolStates: poolStatesByRoute[i] ?? [], tradeType })
    const weightBps = leg.amountIn.mul(BIPS_BASE).div(totalAmountIn).toNumber()
    weighted += impact * weightBps
  })
  return Number((weighted / BIPS_BASE).toFixed(3))
}

export function buildPermitTransactionIfNeeded(args: {
  permitRelevant: boolean
  permit2Allowance?: { amount: BigNumber; expiration: BigNumber }
  swapper: string
  token: string
  requiredAmount: BigNumber
}): { to: string; data: string } | undefined {
  const { permitRelevant, permit2Allowance, token, requiredAmount } = args
  if (!permitRelevant) {
    return undefined
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const sufficient =
    permit2Allowance && permit2Allowance.amount.gte(requiredAmount) && permit2Allowance.expiration.gt(nowSec)
  if (sufficient) {
    return undefined
  }
  return {
    to: PERMIT2_ADDRESS,
    data: buildPermit2ApproveData({
      token,
      spender: GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
      amount: requiredAmount,
      expiration: BigNumber.from(nowSec + PERMIT2_APPROVE_EXPIRATION_SECONDS),
    }),
  }
}
