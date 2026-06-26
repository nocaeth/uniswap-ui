import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { Token } from '@uniswap/sdk-core'
import { computePoolAddress, FeeAmount } from '@uniswap/v3-sdk'
import { type DiscriminatedQuoteResponse, TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  ERC20_METADATA_ABI,
  QUOTER_V2_ABI,
  V3_POOL_STATE_ABI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_FEE_TIERS,
  GNOSIS_QUOTER_ADDRESS,
  GNOSIS_USDCE,
  GNOSIS_USDT,
  GNOSIS_V3_FACTORY_ADDRESS,
  GNOSIS_WETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis as unknown as TradingApi.ChainId

// Typed views over the dynamically-typed ethers v5 Contract instances.
interface QuoterSingleResult {
  amountOut?: BigNumber
  amountIn?: BigNumber
}
interface QuoterContract {
  callStatic: {
    quoteExactInputSingle: (p: {
      tokenIn: string
      tokenOut: string
      amountIn: BigNumber
      fee: number
      sqrtPriceLimitX96: number
    }) => Promise<QuoterSingleResult>
    quoteExactOutputSingle: (p: {
      tokenIn: string
      tokenOut: string
      amount: BigNumber
      fee: number
      sqrtPriceLimitX96: number
    }) => Promise<QuoterSingleResult>
  }
}
interface PoolContract {
  slot0: () => Promise<{ sqrtPriceX96: BigNumber; tick: number }>
  liquidity: () => Promise<BigNumber>
}
interface Erc20Contract {
  symbol: () => Promise<string>
  decimals: () => Promise<number>
}

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
}

const tokenMetaCache = new Map<string, TokenMeta>()

async function getTokenMeta(address: string): Promise<TokenMeta> {
  const key = address.toLowerCase()
  const cached = tokenMetaCache.get(key)
  if (cached) {
    return cached
  }
  const known = KNOWN_TOKENS[key]
  let meta: TokenMeta
  if (known) {
    meta = { address, symbol: known.symbol, decimals: known.decimals }
  } else {
    const erc20 = new Contract(address, ERC20_METADATA_ABI, getGnosisProvider()) as unknown as Erc20Contract
    const [symbol, decimals] = await Promise.all([
      erc20.symbol().catch(() => 'UNKNOWN'),
      erc20.decimals().catch(() => 18),
    ])
    meta = { address, symbol, decimals: Number(decimals) }
  }
  tokenMetaCache.set(key, meta)
  return meta
}

interface Hop {
  tokenIn: string
  tokenOut: string
  fee: FeeAmount
}

interface QuotedHop extends Hop {
  amountIn: BigNumber
  amountOut: BigNumber
}

interface QuotedRoute {
  hops: QuotedHop[]
  amountIn: BigNumber
  amountOut: BigNumber
}

/** All candidate routes (direct across fee tiers + 2-hop via base tokens). */
function buildCandidateRoutes(tokenIn: string, tokenOut: string): Hop[][] {
  const routes: Hop[][] = []
  for (const fee of GNOSIS_FEE_TIERS) {
    routes.push([{ tokenIn, tokenOut, fee }])
  }
  for (const base of GNOSIS_BASE_TOKENS) {
    if (base.toLowerCase() === tokenIn.toLowerCase() || base.toLowerCase() === tokenOut.toLowerCase()) {
      continue
    }
    for (const feeA of GNOSIS_FEE_TIERS) {
      for (const feeB of GNOSIS_FEE_TIERS) {
        routes.push([
          { tokenIn, tokenOut: base, fee: feeA },
          { tokenIn: base, tokenOut, fee: feeB },
        ])
      }
    }
  }
  return routes
}

function getQuoter(): QuoterContract {
  return new Contract(GNOSIS_QUOTER_ADDRESS, QUOTER_V2_ABI, getGnosisProvider()) as unknown as QuoterContract
}

async function quoteRouteExactIn(route: Hop[], amountIn: BigNumber): Promise<QuotedRoute | null> {
  const quoter = getQuoter()
  const hops: QuotedHop[] = []
  let currentIn = amountIn
  for (const hop of route) {
    try {
      const res = await quoter.callStatic.quoteExactInputSingle({
        tokenIn: hop.tokenIn,
        tokenOut: hop.tokenOut,
        amountIn: currentIn,
        fee: hop.fee,
        sqrtPriceLimitX96: 0,
      })
      const amountOut = BigNumber.from(res.amountOut ?? 0)
      if (amountOut.isZero()) {
        return null
      }
      hops.push({ ...hop, amountIn: currentIn, amountOut })
      currentIn = amountOut
    } catch {
      return null // pool missing / no liquidity
    }
  }
  const last = hops[hops.length - 1]
  if (!last) {
    return null
  }
  return { hops, amountIn, amountOut: last.amountOut }
}

async function quoteRouteExactOut(route: Hop[], amountOut: BigNumber): Promise<QuotedRoute | null> {
  const quoter = getQuoter()
  const hops: QuotedHop[] = new Array(route.length)
  let currentOut = amountOut
  for (let i = route.length - 1; i >= 0; i--) {
    const hop = route[i]
    if (!hop) {
      return null
    }
    try {
      const res = await quoter.callStatic.quoteExactOutputSingle({
        tokenIn: hop.tokenIn,
        tokenOut: hop.tokenOut,
        amount: currentOut,
        fee: hop.fee,
        sqrtPriceLimitX96: 0,
      })
      const amountIn = BigNumber.from(res.amountIn ?? 0)
      if (amountIn.isZero()) {
        return null
      }
      hops[i] = { ...hop, amountIn, amountOut: currentOut }
      currentOut = amountIn
    } catch {
      return null
    }
  }
  const first = hops[0]
  if (!first) {
    return null
  }
  return { hops, amountIn: first.amountIn, amountOut }
}

function pickBestRoute(routes: QuotedRoute[], tradeType: TradingApi.TradeType): QuotedRoute | undefined {
  return routes.reduce<QuotedRoute | undefined>((best, route) => {
    if (!best) {
      return route
    }
    if (tradeType === TradingApi.TradeType.EXACT_INPUT) {
      return route.amountOut.gt(best.amountOut) ? route : best // most output
    }
    return route.amountIn.lt(best.amountIn) ? route : best // least input
  }, undefined)
}

function toTokenInRoute(meta: TokenMeta): TradingApi.TokenInRoute {
  return {
    address: meta.address,
    chainId: GNOSIS_CHAIN_ID,
    symbol: meta.symbol,
    decimals: String(meta.decimals),
  }
}

/** Build the per-hop V3PoolInRoute array, reading live pool state for the winner. */
async function buildRoutePools(route: QuotedRoute): Promise<TradingApi.V3PoolInRoute[]> {
  const provider = getGnosisProvider()
  return Promise.all(
    route.hops.map(async (hop) => {
      const [metaIn, metaOut] = await Promise.all([getTokenMeta(hop.tokenIn), getTokenMeta(hop.tokenOut)])
      const poolAddress = computePoolAddress({
        factoryAddress: GNOSIS_V3_FACTORY_ADDRESS,
        tokenA: new Token(UniverseChainId.Gnosis, metaIn.address, metaIn.decimals),
        tokenB: new Token(UniverseChainId.Gnosis, metaOut.address, metaOut.decimals),
        fee: hop.fee,
      })
      const pool = new Contract(poolAddress, V3_POOL_STATE_ABI, provider) as unknown as PoolContract
      const [slot0, liquidity] = await Promise.all([pool.slot0(), pool.liquidity()])
      return {
        type: 'v3-pool',
        address: poolAddress,
        tokenIn: toTokenInRoute(metaIn),
        tokenOut: toTokenInRoute(metaOut),
        fee: String(hop.fee),
        liquidity: BigNumber.from(liquidity).toString(),
        sqrtRatioX96: BigNumber.from(slot0.sqrtPriceX96).toString(),
        tickCurrent: String(slot0.tick),
        amountIn: hop.amountIn.toString(),
        amountOut: hop.amountOut.toString(),
      }
    }),
  )
}

/**
 * Client-side Gnosis V3 quote provider conforming to `TradingApiClient['fetchQuote']`.
 * Quotes candidate routes via QuoterV2 and returns a CLASSIC quote the existing swap
 * pipeline consumes unchanged.
 */
export const fetchGnosisQuote: (
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean },
) => Promise<DiscriminatedQuoteResponse> = async (params) => {
  const tradeType = params.type
  const amount = BigNumber.from(params.amount)
  const candidates = buildCandidateRoutes(params.tokenIn, params.tokenOut)

  const quoted = (
    await Promise.all(
      candidates.map((route) =>
        tradeType === TradingApi.TradeType.EXACT_INPUT
          ? quoteRouteExactIn(route, amount)
          : quoteRouteExactOut(route, amount),
      ),
    )
  ).filter((r): r is QuotedRoute => r !== null)

  const best = pickBestRoute(quoted, tradeType)
  if (!best) {
    throw new Error(`No Gnosis V3 route found for ${params.tokenIn} -> ${params.tokenOut}`)
  }

  const [routePools, blockNumber, metaIn, metaOut] = await Promise.all([
    buildRoutePools(best),
    getGnosisProvider().getBlockNumber(),
    getTokenMeta(params.tokenIn),
    getTokenMeta(params.tokenOut),
  ])

  const routeString = best.hops.map((h, i) => `${i === 0 ? h.tokenIn : ''}-[${h.fee}]-${h.tokenOut}`).join('')

  const quote: TradingApi.ClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: metaIn.address, amount: best.amountIn.toString() },
    output: { token: metaOut.address, amount: best.amountOut.toString() },
    tradeType,
    slippage: params.slippageTolerance,
    route: [routePools],
    routeString,
    quoteId: 'gnosis-local',
    gasUseEstimate: '0',
    blockNumber: String(blockNumber),
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
