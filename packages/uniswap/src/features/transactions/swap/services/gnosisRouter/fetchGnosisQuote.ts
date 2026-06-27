/* oxlint-disable max-lines -- cohesive client-side Gnosis quote provider; splitting would scatter tightly-coupled multicall logic */
import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import type { JsonRpcProvider } from '@ethersproject/providers'
import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { computePoolAddress, FeeAmount, Pool, Route, Trade } from '@uniswap/v3-sdk'
import { type DiscriminatedQuoteResponse, TradingApi } from '@universe/api'
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
  buildPermit2ApproveData,
  PERMIT2_ADDRESS,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/approvals'
import {
  GNOSIS_EURE_V1,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_INDICATIVE_QUOTE_TIMEOUT_MS,
  GNOSIS_MIN_CANDIDATE_POOL_TVL_USD,
  GNOSIS_MULTICALL3_ADDRESS,
  GNOSIS_QUOTE_TIMEOUT_MS,
  GNOSIS_QUOTER_ADDRESS,
  GNOSIS_SDAI,
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
  hasGnosisPoolTvlMetadata,
  type CandidateRoute,
  type GnosisPoolGraphEdge,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import {
  GnosisSdaiAdapterDirection,
  GNOSIS_SDAI_ADAPTER_QUOTE_ID,
  getGnosisSdaiAdapterDirection,
  isGnosisNativeAddress,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis as unknown as TradingApi.ChainId

// Static gas allowance (in gas units) for the standalone Permit2.approve permit tx.
const PERMIT2_APPROVE_GAS = 55_000
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

interface TokenMeta {
  address: string
  symbol: string
  decimals: number
}

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [GNOSIS_WXDAI.toLowerCase()]: { symbol: 'WXDAI', decimals: 18 },
  [GNOSIS_USDCE.toLowerCase()]: { symbol: 'USDC.e', decimals: 6 },
  [GNOSIS_USDT.toLowerCase()]: { symbol: 'USDT', decimals: 6 },
  [GNOSIS_WETH.toLowerCase()]: { symbol: 'WETH', decimals: 18 },
  [GNOSIS_WSTETH.toLowerCase()]: { symbol: 'wstETH', decimals: 18 },
  [GNOSIS_SDAI.toLowerCase()]: { symbol: 'sDAI', decimals: 18 },
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
}): CandidateRoute[] {
  return buildGnosisRouteCandidates({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    graph: buildGnosisPoolGraph(args.poolEdges),
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

/** Quotes every candidate route in a single Multicall3 eth_call via the path-based quoter. */
async function quoteCandidateRoutes(args: {
  provider: JsonRpcProvider
  routes: CandidateRoute[]
  amount: BigNumber
  tradeType: TradingApi.TradeType
}): Promise<QuotedRoute | undefined> {
  const { provider, routes, amount, tradeType } = args
  const exactOutput = tradeType === TradingApi.TradeType.EXACT_OUTPUT
  const fn = exactOutput ? 'quoteExactOutput' : 'quoteExactInput'
  const calls = routes.map((route) => ({
    target: GNOSIS_QUOTER_ADDRESS,
    allowFailure: true,
    callData: quoterInterface.encodeFunctionData(fn, [
      encodePath({ tokens: route.tokens, fees: route.fees, exactOutput }),
      amount,
    ]),
  }))

  const results = await getMulticall(provider).callStatic.aggregate3(calls)

  let best: QuotedRoute | undefined
  results.forEach((result, i) => {
    if (!result.success) {
      return // pool missing / no liquidity
    }
    const route = routes[i]
    if (!route) {
      return
    }
    try {
      const decoded = quoterInterface.decodeFunctionResult(fn, result.returnData)
      const quoted = BigNumber.from(decoded[0])
      const gasEstimate = BigNumber.from(decoded[3] ?? 0)
      if (quoted.isZero()) {
        return
      }
      const candidate: QuotedRoute = exactOutput
        ? { route, amountIn: quoted, amountOut: amount, gasEstimate }
        : { route, amountIn: amount, amountOut: quoted, gasEstimate }

      if (!best) {
        best = candidate
      } else if (exactOutput ? candidate.amountIn.lt(best.amountIn) : candidate.amountOut.gt(best.amountOut)) {
        best = candidate
      }
    } catch {
      // ignore undecodable result
    }
  })
  return best
}

interface ReadCall {
  target: string
  allowFailure: boolean
  callData: string
}

/**
 * Reads everything needed to finalize the winning route in one Multicall3 call:
 * per-hop pool state (cache-aware), metadata for any unknown tokens, and — when an ERC20
 * input may need it — the Permit2→UniversalRouter allowance.
 */
async function finalizeBestRoute(args: {
  provider: JsonRpcProvider
  best: QuotedRoute
  tokenAddresses: string[]
  permitOwner: string | undefined
  permitToken: string | undefined
}): Promise<{
  metas: Map<string, TokenMeta>
  poolStates: PoolState[]
  poolAddresses: string[]
  permit2Allowance?: { amount: BigNumber; expiration: BigNumber }
}> {
  const { provider, best, tokenAddresses, permitOwner, permitToken } = args
  const now = Date.now()

  // Pool addresses are independent of token decimals, so compute them up front.
  const poolAddresses: string[] = []
  for (let i = 0; i < best.route.fees.length; i++) {
    const a = best.route.tokens[i] ?? ''
    const b = best.route.tokens[i + 1] ?? ''
    const fee = best.route.fees[i] ?? FeeAmount.MEDIUM
    poolAddresses.push(
      computePoolAddress({
        factoryAddress: GNOSIS_V3_FACTORY_ADDRESS,
        tokenA: new Token(UniverseChainId.Gnosis, a, 18),
        tokenB: new Token(UniverseChainId.Gnosis, b, 18),
        fee,
      }),
    )
  }

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

  const poolStates = poolAddresses.map((addr) => {
    const cached = poolStateCache.get(addr.toLowerCase())
    if (!cached) {
      throw new Error(`Missing pool state for ${addr} on Gnosis`)
    }
    return cached.state
  })

  return { metas, poolStates, poolAddresses, permit2Allowance: wantsPermit ? permit2Allowance : undefined }
}

function toTokenInRoute(meta: TokenMeta): TradingApi.TokenInRoute {
  return { address: meta.address, chainId: GNOSIS_CHAIN_ID, symbol: meta.symbol, decimals: String(meta.decimals) }
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

  const exactOutput = tradeType === TradingApi.TradeType.EXACT_OUTPUT
  if (direction === GnosisSdaiAdapterDirection.AssetToSdai && exactOutput && isGnosisNativeAddress(params.tokenIn)) {
    return undefined
  }

  const previewFunction =
    direction === GnosisSdaiAdapterDirection.AssetToSdai
      ? exactOutput
        ? 'previewMint'
        : 'previewDeposit'
      : exactOutput
        ? 'previewWithdraw'
        : 'previewRedeem'
  const result = await provider.call({
    to: GNOSIS_SDAI,
    data: sdaiPreviewInterface.encodeFunctionData(previewFunction, [amount]),
  })
  const quotedAmount = BigNumber.from(sdaiPreviewInterface.decodeFunctionResult(previewFunction, result)[0])
  if (quotedAmount.isZero()) {
    throw new Error(`No Gnosis sDAI adapter quote found for ${params.tokenIn} -> ${params.tokenOut}`)
  }

  const amountIn = exactOutput ? quotedAmount : amount
  const amountOut = exactOutput ? amount : quotedAmount
  const recipient = params.recipient ?? params.swapper
  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: params.tokenIn, amount: amountIn.toString() },
    output: { token: params.tokenOut, amount: amountOut.toString(), recipient },
    tradeType,
    slippage: params.slippageTolerance,
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

  const sdaiAdapterQuote = await fetchGnosisSdaiAdapterQuote({ provider, params, tradeType, amount, indicative })
  if (sdaiAdapterQuote) {
    return sdaiAdapterQuote
  }

  const discoveredPoolEdges = await discoverGnosisPoolGraphEdges({
    provider,
    tokenIn: resolvedIn,
    tokenOut: resolvedOut,
  })
  const poolEdges = await annotateGnosisPoolGraphEdgesWithTvl(discoveredPoolEdges)
  const { preferredRoutes, getFallbackRoutes } = buildCandidateRouteSets({
    tokenIn: resolvedIn,
    tokenOut: resolvedOut,
    poolEdges,
  })
  let fallbackRoutes: CandidateRoute[] = []
  if (!preferredRoutes.length) {
    fallbackRoutes = getFallbackRoutes()
  }
  if (!preferredRoutes.length && !fallbackRoutes.length) {
    throw new Error(`No initialized Gnosis V3 pools found for ${params.tokenIn} -> ${params.tokenOut}`)
  }

  // Quote the preferred (TVL-cleared) routes first. A successful preferred quote wins without
  // quoting the fallback set: routes through confirmed sub-threshold pools are intentionally
  // not compared, since their thin liquidity would surface as price impact in the quote anyway.
  // Fallback is only quoted when no preferred route exists or none of them quote successfully.
  const preferredBest = preferredRoutes.length
    ? await quoteCandidateRoutes({ provider, routes: preferredRoutes, amount, tradeType })
    : undefined
  if (!preferredBest && !fallbackRoutes.length) {
    fallbackRoutes = getFallbackRoutes()
  }
  const best =
    preferredBest ??
    (fallbackRoutes.length
      ? await quoteCandidateRoutes({ provider, routes: fallbackRoutes, amount, tradeType })
      : undefined)
  if (!best) {
    throw new Error(`No Gnosis V3 route found for ${params.tokenIn} -> ${params.tokenOut}`)
  }

  // The swap pipeline detects native via the zero/eee sentinel on the quote's input/output
  // token, while the route pools stay denominated in the wrapped (WXDAI) tokens.
  const inputToken = nativeIn ? params.tokenIn : resolvedIn
  const outputToken = nativeOut ? params.tokenOut : resolvedOut

  // Indicative quotes only need input/output amounts; skip all the extra reads.
  if (indicative) {
    const quote: TradingApi.ClassicQuote = {
      chainId: GNOSIS_CHAIN_ID,
      swapper: params.swapper,
      input: { token: inputToken, amount: best.amountIn.toString() },
      output: { token: outputToken, amount: best.amountOut.toString(), recipient: params.swapper },
      tradeType,
      slippage: params.slippageTolerance,
      route: [],
      routeString: '',
      quoteId: 'gnosis-local',
      gasUseEstimate: best.gasEstimate.toString(),
      priceImpact: 0,
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

  const [{ metas, poolStates, permit2Allowance }, blockNumber, gasPrice] = await Promise.all([
    finalizeBestRoute({
      provider,
      best,
      tokenAddresses: best.route.tokens,
      permitOwner: permitRelevant ? params.swapper : undefined,
      permitToken: permitRelevant ? executionInputToken : undefined,
    }),
    provider.getBlockNumber(),
    provider.getGasPrice(),
  ])

  // Build per-hop V3PoolInRoute (only the boundary amounts are consumed downstream).
  const routePools: TradingApi.V3PoolInRoute[] = best.route.fees.map((fee, i) => {
    const metaIn = metas.get((best.route.tokens[i] ?? '').toLowerCase())
    const metaOut = metas.get((best.route.tokens[i + 1] ?? '').toLowerCase())
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
    const isLast = i === best.route.fees.length - 1
    return {
      type: 'v3-pool',
      address: poolAddress,
      tokenIn: toTokenInRoute(metaIn),
      tokenOut: toTokenInRoute(metaOut),
      fee: String(fee),
      liquidity: state.liquidity.toString(),
      sqrtRatioX96: state.sqrtPriceX96.toString(),
      tickCurrent: String(state.tick),
      // Only the first hop's amountIn and the last hop's amountOut are read by the
      // universal-router-sdk; intermediate boundary amounts are unused.
      amountIn: isFirst ? best.amountIn.toString() : '0',
      amountOut: isLast ? best.amountOut.toString() : '0',
    }
  })

  const priceImpact = computeRoutePriceImpact({ best, metas, poolStates, tradeType })
  const gasFee = best.gasEstimate.mul(gasPrice).toString()

  const routeString = best.route.fees
    .map((fee, i) => `${i === 0 ? best.route.tokens[i] : ''}-[${fee}]-${best.route.tokens[i + 1]}`)
    .join('')

  // Build the Permit2 → UniversalRouter approval tx when the current allowance is missing/expired.
  const permitTransaction = buildPermitTransactionIfNeeded({
    permitRelevant,
    permit2Allowance,
    swapper: params.swapper,
    token: executionInputToken,
    requiredAmount: best.amountIn,
  })

  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: inputToken, amount: best.amountIn.toString() },
    output: { token: outputToken, amount: best.amountOut.toString(), recipient: params.swapper },
    tradeType,
    slippage: params.slippageTolerance,
    route: [routePools],
    routeString,
    quoteId: 'gnosis-local',
    gasUseEstimate: best.gasEstimate.toString(),
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

/** Computes real price impact from the route's pool spot prices vs the execution price. */
function computeRoutePriceImpact(args: {
  best: QuotedRoute
  metas: Map<string, TokenMeta>
  poolStates: PoolState[]
  tradeType: TradingApi.TradeType
}): number {
  const { best, metas, poolStates, tradeType } = args
  try {
    const tokenOf = (addr: string): Token => {
      const meta = metas.get(addr.toLowerCase())
      if (!meta) {
        throw new Error(`Missing meta for ${addr}`)
      }
      return new Token(UniverseChainId.Gnosis, meta.address, meta.decimals, meta.symbol)
    }
    const pools = best.route.fees.map((fee, i) => {
      const state = poolStates[i]
      if (!state) {
        throw new Error('Missing pool state')
      }
      return new Pool(
        tokenOf(best.route.tokens[i] ?? ''),
        tokenOf(best.route.tokens[i + 1] ?? ''),
        fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick,
      )
    })
    const currencyIn = tokenOf(best.route.tokens[0] ?? '')
    const currencyOut = tokenOf(best.route.tokens[best.route.tokens.length - 1] ?? '')
    const route = new Route(pools, currencyIn, currencyOut)
    const trade = Trade.createUncheckedTrade({
      route,
      inputAmount: CurrencyAmount.fromRawAmount(currencyIn, best.amountIn.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(currencyOut, best.amountOut.toString()),
      tradeType: tradeType === TradingApi.TradeType.EXACT_OUTPUT ? 1 : 0,
    })
    // classic.ts reads priceImpact as a percent number (e.g. 2.5 → 2.5%).
    return Number(trade.priceImpact.toFixed(3))
  } catch {
    return 0
  }
}

function buildPermitTransactionIfNeeded(args: {
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
  return { to: PERMIT2_ADDRESS, data: buildPermit2ApproveData({ token, spender: GNOSIS_UNIVERSAL_ROUTER_ADDRESS }) }
}
