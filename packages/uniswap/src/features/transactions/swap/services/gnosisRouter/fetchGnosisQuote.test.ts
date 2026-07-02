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
  SDAI_ERC4626_PREVIEW_ABI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_EURE_V1,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT,
  GNOSIS_SDAI,
  GNOSIS_USDCE,
  GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
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
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import {
  getRoutePoolKey,
  type GnosisPoolGraphEdge,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import { GNOSIS_SDAI_ADAPTER_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'

vi.mock('uniswap/src/features/transactions/swap/services/gnosisRouter/provider', () => ({
  getGnosisProvider: vi.fn(),
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
