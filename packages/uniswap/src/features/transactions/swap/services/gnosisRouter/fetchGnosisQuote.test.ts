import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import type { JsonRpcProvider } from '@ethersproject/providers'
import { FeeAmount } from '@uniswap/v3-sdk'
import { TradingApi } from '@universe/api'
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
  GNOSIS_EURE_V1,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_GNO,
  GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT,
  GNOSIS_MULTICALL3_ADDRESS,
  GNOSIS_QUOTER_ADDRESS,
  GNOSIS_SDAI,
  GNOSIS_USDCE,
  GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
  GNOSIS_WETH,
  GNOSIS_WSTETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  buildCandidateRouteSets,
  buildPermitTransactionIfNeeded,
  clearGnosisTokenMetaCache,
  estimateRouteImpactPct,
  fetchGnosisQuote,
  getGnosisCurveV3MixedRouteTemplate,
  getGnosisQuoteSlippageAmounts,
  getGnosisSlippageTolerance,
  GNOSIS_MAX_SLIPPAGE_PERCENT,
  isGnosisQuotePriceImpactViable,
  prefetchGnosisTokenMetas,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote'
import { discoverGnosisPoolGraphEdges } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolDiscovery'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import {
  getRoutePoolKey,
  type GnosisPoolGraphEdge,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import { GNOSIS_SDAI_ADAPTER_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'

vi.mock('uniswap/src/features/transactions/swap/services/gnosisRouter/provider', () => ({
  getGnosisProvider: vi.fn(),
}))

// The single-pass routing tests drive fetchGnosisQuote end-to-end with a synthetic pool universe:
// discovery is mocked to return the universe's edges and TVL annotation is an identity pass, so the
// only RPC surface left is the Multicall3 dispatch handled by makeRoutingProvider below.
vi.mock('uniswap/src/features/transactions/swap/services/gnosisRouter/poolDiscovery', () => ({
  discoverGnosisPoolGraphEdges: vi.fn(),
}))
vi.mock('uniswap/src/features/transactions/swap/services/gnosisRouter/poolTvl', () => ({
  annotateGnosisPoolGraphEdgesWithTvl: vi.fn(async (edges: readonly GnosisPoolGraphEdge[]) => [...edges]),
}))

const TOKEN_A = '0x1000000000000000000000000000000000000001'
const TOKEN_B = '0x2000000000000000000000000000000000000002'
const SWAPPER = '0x1111111111111111111111111111111111111111'
const NATIVE_XDAI_SENTINEL = '0x0000000000000000000000000000000000000000'
const previewInterface = new Interface(SDAI_ERC4626_PREVIEW_ABI)
const permit2Interface = new Interface(PERMIT2_ABI)

// Mirrors GNOSIS_MIN_CANDIDATE_POOL_TVL_USD (1_000) so edges straddle the real floor.
const ABOVE_FLOOR = 5_000
const BELOW_FLOOR = 100

function poolEdge(
  tokenA: string,
  tokenB: string,
  overrides: { fee?: FeeAmount; tvlUSD?: number } = {},
): GnosisPoolGraphEdge {
  return {
    tokenA,
    tokenB,
    fee: overrides.fee ?? FeeAmount.LOW,
    liquidity: '100',
    initialized: true,
    tvlUSD: overrides.tvlUSD,
  }
}

function buildSets(poolEdges: readonly GnosisPoolGraphEdge[]): ReturnType<typeof buildCandidateRouteSets> {
  return buildCandidateRouteSets({ tokenIn: TOKEN_A, tokenOut: TOKEN_B, poolEdges })
}

const DIRECT_LOW = { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.LOW] }
const DIRECT_MEDIUM = { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.MEDIUM] }
const DIRECT_HIGH = { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.HIGH] }

describe('buildCandidateRouteSets', () => {
  it('treats every route as preferred and offers no fallback when no pool has TVL metadata', () => {
    const { preferredRoutes, getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM }),
    ])

    expect(preferredRoutes).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
    expect(getFallbackRoutes()).toEqual([])
  })

  it('drops confirmed sub-threshold pools from preferred but keeps them in fallback', () => {
    const { preferredRoutes, getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: BELOW_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: ABOVE_FLOOR }),
    ])

    expect(preferredRoutes).toContainEqual(DIRECT_MEDIUM)
    expect(preferredRoutes).not.toContainEqual(DIRECT_LOW)

    const fallback = getFallbackRoutes()
    expect(fallback).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
  })

  it('keeps pools with unknown TVL in the preferred set when other pools have TVL', () => {
    const { preferredRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: ABOVE_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM }), // unknown TVL — must be kept
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.HIGH, tvlUSD: BELOW_FLOOR }), // dust — dropped
    ])

    expect(preferredRoutes).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
    expect(preferredRoutes).not.toContainEqual(DIRECT_HIGH)
  })

  it('returns no fallback when the TVL filter removes nothing (preferred === fallback)', () => {
    const { preferredRoutes, getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: ABOVE_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: ABOVE_FLOOR }),
    ])

    expect(preferredRoutes).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
    expect(getFallbackRoutes()).toEqual([])
  })

  it('builds the fallback set at most once (memoized)', () => {
    const { getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: BELOW_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: ABOVE_FLOOR }),
    ])

    // A non-empty fallback returns the same memoized array reference across calls.
    expect(getFallbackRoutes()).toBe(getFallbackRoutes())
  })
})

describe('getGnosisCurveV3MixedRouteTemplate', () => {
  it('builds the eureusd -> GBPe mixed path through legacy GBPe for either displayed GBPe alias', () => {
    expect(getGnosisCurveV3MixedRouteTemplate({ tokenIn: GNOSIS_WXDAI, tokenOut: GNOSIS_GBPE_V1 })).toMatchObject({
      direction: 'curve-to-v3',
      v3TokenIn: GNOSIS_EURE_V1,
      v3TokenOut: GNOSIS_GBPE_V1,
      executionTokenOut: GNOSIS_GBPE_V1,
    })
    expect(getGnosisCurveV3MixedRouteTemplate({ tokenIn: GNOSIS_WXDAI, tokenOut: GNOSIS_GBPE_V2 })).toMatchObject({
      direction: 'curve-to-v3',
      v3TokenIn: GNOSIS_EURE_V1,
      v3TokenOut: GNOSIS_GBPE_V1,
      executionTokenOut: GNOSIS_GBPE_V1,
    })

    expect(getGnosisCurveV3MixedRouteTemplate({ tokenIn: GNOSIS_GBPE_V1, tokenOut: GNOSIS_USDCE })).toMatchObject({
      direction: 'v3-to-curve',
      v3TokenIn: GNOSIS_GBPE_V1,
      v3TokenOut: GNOSIS_EURE_V1,
      executionTokenIn: GNOSIS_GBPE_V1,
    })
    expect(getGnosisCurveV3MixedRouteTemplate({ tokenIn: GNOSIS_GBPE_V2, tokenOut: GNOSIS_USDCE })).toMatchObject({
      direction: 'v3-to-curve',
      v3TokenIn: GNOSIS_GBPE_V1,
      v3TokenOut: GNOSIS_EURE_V1,
      executionTokenIn: GNOSIS_GBPE_V1,
    })
  })
})

describe('fetchGnosisQuote sDAI adapter path', () => {
  const provider = {
    call: vi.fn(),
    getBlockNumber: vi.fn(),
    getGasPrice: vi.fn(),
  }

  beforeEach(() => {
    vi.mocked(getGnosisProvider).mockReturnValue(provider as unknown as ReturnType<typeof getGnosisProvider>)
    provider.call.mockReset()
    provider.getBlockNumber.mockReset()
    provider.getGasPrice.mockReset()
  })

  it('quotes native xDAI -> sDAI directly from ERC4626 previewDeposit', async () => {
    provider.call.mockResolvedValueOnce(previewInterface.encodeFunctionResult('previewDeposit', ['950']))
    provider.getBlockNumber.mockResolvedValueOnce(123)
    provider.getGasPrice.mockResolvedValueOnce('10')

    const response = await fetchGnosisQuote({
      type: TradingApi.TradeType.EXACT_INPUT,
      amount: '1000',
      tokenInChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      tokenOutChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      tokenIn: NATIVE_XDAI_SENTINEL,
      tokenOut: GNOSIS_SDAI,
      swapper: SWAPPER,
    })

    expect(provider.call).toHaveBeenCalledWith({
      to: GNOSIS_SDAI,
      data: previewInterface.encodeFunctionData('previewDeposit', ['1000']),
    })
    expect(response.routing).toBe(TradingApi.Routing.CLASSIC)
    if (response.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected classic quote')
    }
    expect(response.quote.quoteId).toBe(GNOSIS_SDAI_ADAPTER_QUOTE_ID)
    expect(response.quote.input?.amount).toBe('1000')
    expect(response.quote.output?.amount).toBe('950')
    expect(response.quote.route).toEqual([])
    expect(response.quote.gasFee).toBe('1800000')
    expect(response.quote.slippage).toBe(0.5)
  })

  it('rejects exact-output direct sDAI adapter quotes', async () => {
    await expect(
      fetchGnosisQuote(
        {
          type: TradingApi.TradeType.EXACT_OUTPUT,
          amount: '1000',
          tokenInChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
          tokenOutChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
          tokenIn: GNOSIS_SDAI,
          tokenOut: GNOSIS_WXDAI,
          swapper: SWAPPER,
          slippageTolerance: 0.75,
        },
        { indicative: true },
      ),
    ).rejects.toThrow('Exact-output Gnosis sDAI adapter swaps are not supported')

    expect(provider.call).not.toHaveBeenCalled()
  })
})

describe('buildPermitTransactionIfNeeded', () => {
  it('encodes Permit2 approval for the exact required spend amount', () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const permitTransaction = buildPermitTransactionIfNeeded({
        permitRelevant: true,
        permit2Allowance: { amount: BigNumber.from(0), expiration: BigNumber.from(0) },
        swapper: SWAPPER,
        token: TOKEN_A,
        requiredAmount: BigNumber.from('12345'),
      })

      expect(permitTransaction?.to).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3')
      const decoded = permit2Interface.decodeFunctionData('approve', permitTransaction?.data ?? '')
      expect(decoded[0]).toBe(TOKEN_A)
      expect(decoded[1]).toBe(GNOSIS_UNIVERSAL_ROUTER_ADDRESS)
      expect(decoded[2].toString()).toBe('12345')
      expect(decoded[3].toString()).toBe('1700001800')
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  it('skips Permit2 approval when the allowance already covers the exact input amount', () => {
    const permitTransaction = buildPermitTransactionIfNeeded({
      permitRelevant: true,
      permit2Allowance: {
        amount: BigNumber.from('12345'),
        expiration: BigNumber.from(Math.floor(Date.now() / 1000) + 60),
      },
      swapper: SWAPPER,
      token: TOKEN_A,
      requiredAmount: BigNumber.from('12345'),
    })

    expect(permitTransaction).toBeUndefined()
  })
})

describe('getGnosisQuoteSlippageAmounts', () => {
  it('uses the slippage-adjusted max input for exact-output swaps', () => {
    const amounts = getGnosisQuoteSlippageAmounts({
      amountIn: BigNumber.from('12345'),
      amountOut: BigNumber.from('1000'),
      tradeType: TradingApi.TradeType.EXACT_OUTPUT,
      slippagePercent: 0.5,
    })

    expect(amounts.maximumAmountIn.toString()).toBe('12406')
    expect(amounts.minimumAmountOut.toString()).toBe('1000')
  })

  it('keeps exact-input approval amount exact while slippage-adjusting minimum output', () => {
    const amounts = getGnosisQuoteSlippageAmounts({
      amountIn: BigNumber.from('12345'),
      amountOut: BigNumber.from('1000'),
      tradeType: TradingApi.TradeType.EXACT_INPUT,
      slippagePercent: 0.5,
    })

    expect(amounts.maximumAmountIn.toString()).toBe('12345')
    expect(amounts.minimumAmountOut.toString()).toBe('995')
  })
})

describe('getGnosisSlippageTolerance', () => {
  it('clamps requests above the Gnosis max down to the ceiling', () => {
    // The deployed routers only enforce an absolute amountOutMinimum, so the percentage cap
    // lives here. A 100% custom slippage must never reach the builders as 100%.
    expect(getGnosisSlippageTolerance({ slippageTolerance: 100 })).toBe(GNOSIS_MAX_SLIPPAGE_PERCENT)
    expect(getGnosisSlippageTolerance({ slippageTolerance: GNOSIS_MAX_SLIPPAGE_PERCENT + 1 })).toBe(
      GNOSIS_MAX_SLIPPAGE_PERCENT,
    )
  })

  it('passes through tolerances at or below the ceiling', () => {
    expect(getGnosisSlippageTolerance({ slippageTolerance: 0.5 })).toBe(0.5)
    expect(getGnosisSlippageTolerance({ slippageTolerance: GNOSIS_MAX_SLIPPAGE_PERCENT })).toBe(
      GNOSIS_MAX_SLIPPAGE_PERCENT,
    )
  })

  it('uses the default when unset and floors negatives to zero', () => {
    expect(getGnosisSlippageTolerance({})).toBe(0.5)
    expect(getGnosisSlippageTolerance({ slippageTolerance: -1 })).toBe(0)
  })
})

describe('token metadata prefetch and impact-estimate gate', () => {
  const multicallInterface = new Interface(MULTICALL3_ABI)
  const erc20MetaInterface = new Interface(ERC20_METADATA_ABI)
  // Not in KNOWN_TOKENS — stands in for any long-tail token (the original COW→EURe failure mode).
  const TOKEN_X = '0x3000000000000000000000000000000000000003'

  // ethers Contract requires a real-looking provider; only `call` is exercised (Multicall3 aggregate3).
  const provider = { call: vi.fn(), _isProvider: true }
  const asProvider = (): JsonRpcProvider => provider as unknown as JsonRpcProvider

  // TOKEN_X/WXDAI pool at 1:1 spot (sqrtPriceX96 = 2^96, both 18 decimals).
  const route = { tokens: [TOKEN_X, GNOSIS_WXDAI], fees: [FeeAmount.MEDIUM] }
  const byKey = new Map([
    [
      getRoutePoolKey({ tokenA: TOKEN_X, tokenB: GNOSIS_WXDAI, fee: FeeAmount.MEDIUM }),
      { sqrtPriceX96: BigNumber.from(2).pow(96), tick: 0, liquidity: BigNumber.from('1000000000000000000') },
    ],
  ])
  // Garbage quote through a near-dead pool: 100 in → 0.0315 out at 1:1 spot (~99.97% impact).
  const garbageQuote = {
    route,
    amountIn: BigNumber.from('100000000000000000000'),
    amountOut: BigNumber.from('31500000000000000'),
    gasEstimate: BigNumber.from(0),
  }

  const metaMulticallResult = (symbol: string, decimals: number): string =>
    multicallInterface.encodeFunctionResult('aggregate3', [
      [
        { success: true, returnData: erc20MetaInterface.encodeFunctionResult('symbol', [symbol]) },
        { success: true, returnData: erc20MetaInterface.encodeFunctionResult('decimals', [decimals]) },
      ],
    ])

  beforeEach(() => {
    clearGnosisTokenMetaCache()
    provider.call.mockReset()
  })

  it('estimates 0 (fail-open) for an unknown token, and real impact once the prefetch fills the cache', async () => {
    // Before prefetch: TOKEN_X is in neither KNOWN_TOKENS nor tokenMetaCache → estimator is blind.
    expect(estimateRouteImpactPct({ quoted: garbageQuote, byKey, tradeType: TradingApi.TradeType.EXACT_INPUT })).toBe(0)

    provider.call.mockResolvedValueOnce(metaMulticallResult('XTKN', 18))
    await prefetchGnosisTokenMetas({ provider: asProvider(), addresses: [TOKEN_X, GNOSIS_WXDAI] })
    // WXDAI is already known: only TOKEN_X should have been read, in a single multicall.
    expect(provider.call).toHaveBeenCalledTimes(1)

    // After prefetch: knownMetasForRoute falls back to tokenMetaCache and the garbage quote is
    // measured at its real ~100% impact instead of being waved through as viable.
    const impact = estimateRouteImpactPct({
      quoted: garbageQuote,
      byKey,
      tradeType: TradingApi.TradeType.EXACT_INPUT,
    })
    expect(impact).toBeGreaterThan(GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT)
    expect(isGnosisQuotePriceImpactViable(impact)).toBe(false)
  })

  it('skips the multicall entirely when every address is already known', async () => {
    await prefetchGnosisTokenMetas({ provider: asProvider(), addresses: [GNOSIS_WXDAI, GNOSIS_USDCE] })
    expect(provider.call).not.toHaveBeenCalled()
  })

  it('is non-fatal on RPC failure and leaves the estimator fail-open', async () => {
    provider.call.mockRejectedValueOnce(new Error('rpc down'))
    await expect(prefetchGnosisTokenMetas({ provider: asProvider(), addresses: [TOKEN_X] })).resolves.toBeUndefined()
    expect(estimateRouteImpactPct({ quoted: garbageQuote, byKey, tradeType: TradingApi.TradeType.EXACT_INPUT })).toBe(0)
  })
})

describe('isGnosisQuotePriceImpactViable', () => {
  it('accepts normal and high-but-plausible price impact', () => {
    expect(isGnosisQuotePriceImpactViable(0)).toBe(true)
    expect(isGnosisQuotePriceImpactViable(2.5)).toBe(true)
    expect(isGnosisQuotePriceImpactViable(GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT - 0.001)).toBe(true)
  })

  it('rejects absurd price impact at or above the ceiling (near-empty-pool quote)', () => {
    expect(isGnosisQuotePriceImpactViable(GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT)).toBe(false)
    // 10 WETH -> 0.000133 WXDAI surfaces as ~100% impact when no liquid path exists within the hop cap.
    expect(isGnosisQuotePriceImpactViable(99.99)).toBe(false)
  })
})

describe('fetchGnosisQuote single-pass hop search', () => {
  const multicallInterface = new Interface(MULTICALL3_ABI)
  const quoterInterface = new Interface(QUOTER_V2_ABI)
  const poolStateInterface = new Interface(V3_POOL_STATE_ABI)
  const erc20MetaInterface = new Interface(ERC20_METADATA_ABI)

  const SQRT_PRICE_ONE = BigNumber.from(2).pow(96) // spot price 1.0 for every synthetic pool
  const POOL_LIQUIDITY = '1000000000000000000000'
  const AMOUNT_IN = BigNumber.from('100000000000000000000') // 100e18
  // Matches UNCONNECTED_SWAPPER in fetchGnosisQuote.ts so the Permit2 read stays out of the flow.
  const UNCONNECTED = '0xAAAA44272dc658575Ba38f43C438447dDED45358'

  let poolSalt = 0
  function syntheticEdge(tokenA: string, tokenB: string): GnosisPoolGraphEdge {
    poolSalt += 1
    return {
      tokenA,
      tokenB,
      fee: FeeAmount.MEDIUM,
      liquidity: POOL_LIQUIDITY,
      initialized: true,
      poolAddress: `0x${poolSalt.toString(16).padStart(40, '0')}`,
      sqrtPriceX96: SQRT_PRICE_ONE,
      tick: 0,
    }
  }

  /** Token sequence of a packed V3 path: token(20 bytes) | fee(3) | token(20) | … */
  function decodePathTokens(path: string): string[] {
    const hex = path.toLowerCase().replace(/^0x/, '')
    const tokens: string[] = []
    for (let i = 0; i + 40 <= hex.length; i += 46) {
      tokens.push(`0x${hex.slice(i, i + 40)}`)
    }
    return tokens
  }

  function pathKey(tokens: readonly string[]): string {
    return tokens.map((token) => token.toLowerCase()).join(':')
  }

  interface RoutingProvider {
    provider: {
      _isProvider: boolean
      call: ReturnType<typeof vi.fn>
      getBlockNumber: ReturnType<typeof vi.fn>
      getGasPrice: ReturnType<typeof vi.fn>
    }
    /** One entry per Multicall3 round-trip that contained at least one quoter call. */
    quoterMulticalls: number[]
  }

  /**
   * Provider whose only surface is Multicall3.aggregate3; inner calls are dispatched by selector:
   * quoter quoteExactInput answers from `quotes` (keyed by lowercased path token sequence, linear in
   * amountIn), slot0/liquidity return the synthetic pool state, and symbol/decimals return an
   * 18-decimal TKN for the arbitrary endpoint tokens. Anything else fails per-call (allowFailure).
   */
  function makeRoutingProvider(quotes: Record<string, (amountIn: BigNumber) => BigNumber>): RoutingProvider {
    const quoterMulticalls: number[] = []
    const call = vi.fn(async (tx: { to: string; data: string }): Promise<string> => {
      if (tx.to.toLowerCase() !== GNOSIS_MULTICALL3_ADDRESS.toLowerCase()) {
        throw new Error(`Unexpected non-multicall eth_call to ${tx.to}`)
      }
      const [calls] = multicallInterface.decodeFunctionData('aggregate3', tx.data) as [
        { target: string; callData: string }[],
      ]
      let quoterCalls = 0
      const results = calls.map(({ target, callData }) => {
        const selector = callData.slice(0, 10)
        if (target.toLowerCase() === GNOSIS_QUOTER_ADDRESS.toLowerCase()) {
          quoterCalls += 1
          if (selector !== quoterInterface.getSighash('quoteExactInput')) {
            return { success: false, returnData: '0x' }
          }
          const [path, amountIn] = quoterInterface.decodeFunctionData('quoteExactInput', callData)
          const quote = quotes[pathKey(decodePathTokens(path))]
          if (!quote) {
            return { success: false, returnData: '0x' }
          }
          return {
            success: true,
            returnData: quoterInterface.encodeFunctionResult('quoteExactInput', [
              quote(BigNumber.from(amountIn)),
              [],
              [],
              BigNumber.from(90_000),
            ]),
          }
        }
        if (selector === poolStateInterface.getSighash('slot0')) {
          return {
            success: true,
            returnData: poolStateInterface.encodeFunctionResult('slot0', [SQRT_PRICE_ONE, 0, 0, 1, 1, 0, true]),
          }
        }
        if (selector === poolStateInterface.getSighash('liquidity')) {
          return {
            success: true,
            returnData: poolStateInterface.encodeFunctionResult('liquidity', [POOL_LIQUIDITY]),
          }
        }
        if (selector === erc20MetaInterface.getSighash('decimals')) {
          return { success: true, returnData: erc20MetaInterface.encodeFunctionResult('decimals', [18]) }
        }
        if (selector === erc20MetaInterface.getSighash('symbol')) {
          return { success: true, returnData: erc20MetaInterface.encodeFunctionResult('symbol', ['TKN']) }
        }
        return { success: false, returnData: '0x' }
      })
      if (quoterCalls > 0) {
        quoterMulticalls.push(quoterCalls)
      }
      return multicallInterface.encodeFunctionResult('aggregate3', [results])
    })

    const provider = {
      _isProvider: true, // lets ethers Contract accept the mock as a Provider
      call,
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getGasPrice: vi.fn().mockResolvedValue(BigNumber.from(10)),
    }
    vi.mocked(getGnosisProvider).mockReturnValue(provider as unknown as ReturnType<typeof getGnosisProvider>)
    return { provider, quoterMulticalls }
  }

  function quoteParams(args: { tokenIn: string; tokenOut: string }): TradingApi.QuoteRequest {
    return {
      type: TradingApi.TradeType.EXACT_INPUT,
      amount: AMOUNT_IN.toString(),
      tokenInChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      tokenOutChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      swapper: UNCONNECTED,
    }
  }

  it('returns the better 4-hop route even when a viable-but-worse 3-hop route exists (single pass)', async () => {
    const tokenIn = '0x3000000000000000000000000000000000000003'
    const tokenOut = '0x4000000000000000000000000000000000000004'
    // COW-shaped universe: a thin 3-hop path (IN-WETH-GNO-OUT) and a deep 4-hop path
    // (IN-WETH-wstETH-sDAI-OUT). The retired tier escalation stopped at the 3-hop tier because its
    // 40%-impact quote sat under the 90% ceiling; the single pass must pick the 4-hop output.
    vi.mocked(discoverGnosisPoolGraphEdges).mockResolvedValue([
      syntheticEdge(tokenIn, GNOSIS_WETH),
      syntheticEdge(GNOSIS_WETH, GNOSIS_GNO),
      syntheticEdge(GNOSIS_GNO, tokenOut),
      syntheticEdge(GNOSIS_WETH, GNOSIS_WSTETH),
      syntheticEdge(GNOSIS_WSTETH, GNOSIS_SDAI),
      syntheticEdge(GNOSIS_SDAI, tokenOut),
    ])
    const { quoterMulticalls } = makeRoutingProvider({
      [pathKey([tokenIn, GNOSIS_WETH, GNOSIS_GNO, tokenOut])]: (amountIn) => amountIn.mul(60).div(100),
      [pathKey([tokenIn, GNOSIS_WETH, GNOSIS_WSTETH, GNOSIS_SDAI, tokenOut])]: (amountIn) =>
        amountIn.mul(9999).div(10_000),
    })

    const response = await fetchGnosisQuote(quoteParams({ tokenIn, tokenOut }))

    if (response.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected classic quote')
    }
    expect(response.quote.output?.amount).toBe(AMOUNT_IN.mul(9999).div(10_000).toString())
    expect(response.quote.route).toHaveLength(1)
    expect(response.quote.route?.[0]).toHaveLength(4) // the 4-hop leg, not the 3-hop one
    // All candidates (1..GNOSIS_MAX_ROUTE_HOPS hops) were ranked in ONE quoter round-trip.
    expect(quoterMulticalls).toHaveLength(1)
  })

  it('finds a 4-hop-only route on the indicative (keystroke) path too', async () => {
    const tokenIn = '0x5000000000000000000000000000000000000005'
    const tokenOut = '0x6000000000000000000000000000000000000006'
    // Only a 4-hop chain exists; the retired 3-hop-only indicative tier threw "no route" here.
    vi.mocked(discoverGnosisPoolGraphEdges).mockResolvedValue([
      syntheticEdge(tokenIn, GNOSIS_WETH),
      syntheticEdge(GNOSIS_WETH, GNOSIS_WSTETH),
      syntheticEdge(GNOSIS_WSTETH, GNOSIS_SDAI),
      syntheticEdge(GNOSIS_SDAI, tokenOut),
    ])
    const { quoterMulticalls } = makeRoutingProvider({
      [pathKey([tokenIn, GNOSIS_WETH, GNOSIS_WSTETH, GNOSIS_SDAI, tokenOut])]: (amountIn) => amountIn.mul(42).div(100),
    })

    const response = await fetchGnosisQuote(quoteParams({ tokenIn, tokenOut }), { indicative: true })

    if (response.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected classic quote')
    }
    expect(response.quote.output?.amount).toBe(AMOUNT_IN.mul(42).div(100).toString())
    expect(quoterMulticalls).toHaveLength(1)
  })

  it('still rejects a quote whose only route runs through a near-empty pool (absurd impact)', async () => {
    const tokenIn = '0x7000000000000000000000000000000000000007'
    const tokenOut = '0x8000000000000000000000000000000000000008'
    vi.mocked(discoverGnosisPoolGraphEdges).mockResolvedValue([
      syntheticEdge(tokenIn, GNOSIS_WETH),
      syntheticEdge(GNOSIS_WETH, GNOSIS_GNO),
      syntheticEdge(GNOSIS_GNO, tokenOut),
    ])
    // 100e18 in -> 315 wei out: ~100% price impact against the 1.0 spot price.
    makeRoutingProvider({
      [pathKey([tokenIn, GNOSIS_WETH, GNOSIS_GNO, tokenOut])]: () => BigNumber.from(315),
    })

    await expect(fetchGnosisQuote(quoteParams({ tokenIn, tokenOut }))).rejects.toThrow(/price impact/)
  })
})
