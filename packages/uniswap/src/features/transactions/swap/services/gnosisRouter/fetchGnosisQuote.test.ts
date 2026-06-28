import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { FeeAmount } from '@uniswap/v3-sdk'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { PERMIT2_ABI, SDAI_ERC4626_PREVIEW_ABI } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT,
  GNOSIS_SDAI,
  GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  buildCandidateRouteSets,
  buildPermitTransactionIfNeeded,
  fetchGnosisQuote,
  isGnosisQuotePriceImpactViable,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import type { GnosisPoolGraphEdge } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
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

  it('quotes sDAI -> WXDAI exact output directly from ERC4626 previewWithdraw', async () => {
    provider.call.mockResolvedValueOnce(previewInterface.encodeFunctionResult('previewWithdraw', ['1050']))

    const response = await fetchGnosisQuote(
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
    )

    expect(provider.call).toHaveBeenCalledWith({
      to: GNOSIS_SDAI,
      data: previewInterface.encodeFunctionData('previewWithdraw', ['1000']),
    })
    expect(response.routing).toBe(TradingApi.Routing.CLASSIC)
    if (response.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected classic quote')
    }
    expect(response.quote.quoteId).toBe(GNOSIS_SDAI_ADAPTER_QUOTE_ID)
    expect(response.quote.input?.amount).toBe('1050')
    expect(response.quote.output?.amount).toBe('1000')
    expect(response.quote.gasFee).toBeUndefined()
    expect(response.quote.slippage).toBe(0.75)
  })
})

describe('buildPermitTransactionIfNeeded', () => {
  it('encodes Permit2 approval for the exact required input amount', () => {
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
