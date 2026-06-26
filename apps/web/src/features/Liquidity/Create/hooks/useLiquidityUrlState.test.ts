import { useQueryState, useQueryStates } from 'nuqs'
import { nativeOnChain, USDC_UNICHAIN } from 'uniswap/src/constants/tokens'
import { GNOSIS_CHAIN_INFO } from 'uniswap/src/features/chains/evm/info/gnosis'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { vi } from 'vitest'
import { NATIVE_CHAIN_ID } from '~/constants/tokens'
import { useLiquidityUrlState } from '~/features/Liquidity/Create/hooks/useLiquidityUrlState'
import { DEFAULT_FEE_DATA, PositionFlowStep } from '~/features/Liquidity/Create/types'
import { useCurrencyWithLoading } from '~/hooks/Tokens'
import { mocked } from '~/test-utils/mocked'
import { renderHook } from '~/test-utils/render'
import { PositionField } from '~/types/position'

vi.mock('nuqs', async () => {
  const actual = await vi.importActual('nuqs')
  return {
    ...actual,
    useQueryState: vi.fn(),
    useQueryStates: vi.fn(),
  }
})

vi.mock('~/hooks/Tokens', async () => {
  const actual = await vi.importActual('~/hooks/Tokens')
  return {
    ...actual,
    useCurrencyWithLoading: vi.fn(),
    checkIsNative: actual.checkIsNative,
  }
})

const useQueryStateMock = mocked(useQueryState) as any
const useQueryStatesMock = mocked(useQueryStates)
const useCurrencyWithLoadingMock = mocked(useCurrencyWithLoading)

describe('useLiquidityUrlState', () => {
  const defaultChainId = UniverseChainId.Gnosis
  const defaultInitialToken = nativeOnChain(defaultChainId)
  const defaultErc20Token = GNOSIS_CHAIN_INFO.tokens.USDC
  const defaultWrappedNative = GNOSIS_CHAIN_INFO.tokens.WXDAI

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock useQueryState for step parameter
    useQueryStateMock.mockReturnValue([PositionFlowStep.SELECT_TOKENS_AND_FEE_TIER, vi.fn()])

    // Mock useQueryStates for replace parameters with default empty state
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])

    useCurrencyWithLoadingMock.mockImplementation(({ address }: { address?: string; chainId?: number }) => {
      // Handle native token: 'ETH' or 'NATIVE'
      if (
        (typeof address === 'string' && address.toUpperCase() === NATIVE_CHAIN_ID) ||
        (typeof address === 'string' && address.toUpperCase() === 'ETH')
      ) {
        return { currency: defaultInitialToken, loading: false }
      }
      if (address === defaultErc20Token.address) {
        return { currency: defaultErc20Token, loading: false }
      }
      if (address === defaultWrappedNative.address) {
        return { currency: defaultWrappedNative, loading: false }
      }
      return { currency: undefined, loading: false }
    })
  })

  it('returns defaults when no params', () => {
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultInitialToken)
    expect(result.current.tokenB).toBeUndefined()
    expect(result.current.fee).toEqual(DEFAULT_FEE_DATA)
    expect(result.current.hook).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  it('parses currencyA', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: NATIVE_CHAIN_ID,
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultInitialToken)
    expect(result.current.tokenB).toBeUndefined()
  })

  it('parses currencyA and currencyB', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: defaultErc20Token.address,
        currencyB: defaultWrappedNative.address,
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultErc20Token)
    expect(result.current.tokenB).toEqual(defaultWrappedNative)
  })

  it('defaults to native token when currencyA is for a different chain', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: USDC_UNICHAIN.address,
        currencyB: '',
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultInitialToken)
    expect(result.current.tokenB).toBeUndefined()
  })

  it('prevents duplicate tokens', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: defaultErc20Token.address,
        currencyB: defaultErc20Token.address,
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultErc20Token)
    expect(result.current.tokenB).toBeUndefined()
  })

  it('prevents native + wrapped native', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: NATIVE_CHAIN_ID,
        currencyB: defaultWrappedNative.address,
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultInitialToken)
    expect(result.current.tokenB).toBeUndefined()
  })

  it('parses fee data JSON object', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: { feeAmount: 500, tickSpacing: 10, isDynamic: true },
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.fee?.feeAmount).toBe(500)
    expect(result.current.fee?.isDynamic).toBe(true)
    expect(result.current.fee?.tickSpacing).toBe(10)
  })

  it('returns default fee when no fee data provided', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA, // Parser will return default for invalid/missing data
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.fee).toEqual(DEFAULT_FEE_DATA)
  })

  it('parses hook param', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: '0x0000000000000000000000000000000000000001',
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.hook).toBe('0x0000000000000000000000000000000000000001')
  })

  it('returns null for invalid hook param', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null, // Parser will return null for invalid address
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.hook).toBe(null)
  })

  it('handles loading state', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: defaultErc20Token.address,
        currencyB: defaultWrappedNative.address,
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    useCurrencyWithLoadingMock.mockImplementation(({ address }: { address?: string; chainId?: number }) => {
      if (address === defaultErc20Token.address) {
        return { currency: defaultErc20Token, loading: true }
      }
      if (address === defaultWrappedNative.address) {
        return { currency: defaultWrappedNative, loading: false }
      }
      return { currency: undefined, loading: false }
    })
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.loading).toBe(true)
  })

  it('parses chain param and uses supportedChainId', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: defaultErc20Token.address,
        currencyB: '',
        chain: UniverseChainId.Gnosis,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultErc20Token)
    expect(result.current.chainId).toBe(UniverseChainId.Gnosis)
  })

  it('handles missing currencyA and currencyB', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: { feeAmount: 3000, tickSpacing: 60, isDynamic: false },
        hook: null,
        priceRangeState: {},
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.tokenA).toEqual(defaultInitialToken)
    expect(result.current.tokenB).toBeUndefined()
  })

  it('parses price range state parameters', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {
          minTick: 0,
          maxTick: 1,
          initialPrice: '2.0',
          fullRange: true,
          priceInverted: false,
        },
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.priceRangeState.minTick).toBe(0)
    expect(result.current.priceRangeState.maxTick).toBe(1)
    expect(result.current.priceRangeState.initialPrice).toBe('2.0')
    expect(result.current.priceRangeState.fullRange).toBe(true)
    expect(result.current.priceRangeState.priceInverted).toBe(false)
  })

  it('parses partial price range state', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {
          minTick: 0,
          maxTick: 1,
          fullRange: false,
        },
        depositState: {},
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.priceRangeState.minTick).toBe(0)
    expect(result.current.priceRangeState.maxTick).toBe(1)
    expect(result.current.priceRangeState.initialPrice).toBeUndefined()
    expect(result.current.priceRangeState.fullRange).toBe(false)
    expect(result.current.priceRangeState.priceInverted).toBeUndefined()
  })

  it('parses deposit state parameters', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {
          exactAmounts: {
            [PositionField.TOKEN0]: '100.5',
            [PositionField.TOKEN1]: '200.75',
          },
          exactField: PositionField.TOKEN0,
        },
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN0]).toBe('100.5')
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN1]).toBe('200.75')
    expect(result.current.depositState.exactField).toBe(PositionField.TOKEN0)
  })

  it('parses partial deposit amounts', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {
          exactAmounts: {
            [PositionField.TOKEN0]: '50.0',
          },
          exactField: PositionField.TOKEN1,
        },
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN0]).toBe('50.0')
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN1]).toBeUndefined()
    expect(result.current.depositState.exactField).toBe(PositionField.TOKEN1)
  })

  it('handles empty deposit amounts', () => {
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: '',
        currencyB: '',
        chain: null,
        fee: DEFAULT_FEE_DATA,
        hook: null,
        priceRangeState: {},
        depositState: {
          exactAmounts: {},
        },
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN0]).toBeUndefined()
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN1]).toBeUndefined()
  })

  it('parses flow step parameter', () => {
    useQueryStateMock.mockReturnValue([PositionFlowStep.PRICE_RANGE, vi.fn()])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.flowStep).toBe(PositionFlowStep.PRICE_RANGE)
  })

  it('parses all valid flow step values', () => {
    // Test step 0
    useQueryStateMock.mockReturnValue([PositionFlowStep.SELECT_TOKENS_AND_FEE_TIER, vi.fn()])
    let { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.flowStep).toBe(PositionFlowStep.SELECT_TOKENS_AND_FEE_TIER)

    // Test step 1
    useQueryStateMock.mockReturnValue([PositionFlowStep.PRICE_RANGE, vi.fn()])
    result = renderHook(() => useLiquidityUrlState()).result
    expect(result.current.flowStep).toBe(PositionFlowStep.PRICE_RANGE)

    // Test step 2
    useQueryStateMock.mockReturnValue([PositionFlowStep.DEPOSIT, vi.fn()])
    result = renderHook(() => useLiquidityUrlState()).result
    expect(result.current.flowStep).toBe(PositionFlowStep.DEPOSIT)
  })

  it('returns default flow step when no step provided', () => {
    useQueryStateMock.mockReturnValue([PositionFlowStep.SELECT_TOKENS_AND_FEE_TIER, vi.fn()])
    const { result } = renderHook(() => useLiquidityUrlState())
    expect(result.current.flowStep).toBe(PositionFlowStep.SELECT_TOKENS_AND_FEE_TIER)
  })

  it('returns all expected fields in the response', () => {
    useQueryStateMock.mockReturnValue([PositionFlowStep.PRICE_RANGE, vi.fn()])
    useQueryStatesMock.mockReturnValue([
      {
        currencyA: defaultErc20Token.address,
        currencyB: '',
        chain: UniverseChainId.Gnosis,
        fee: { feeAmount: 3000, tickSpacing: 60, isDynamic: false },
        hook: '0x0000000000000000000000000000000000000001',
        priceRangeState: {
          minTick: 0,
          maxTick: 1,
          initialPrice: '1.5',
          fullRange: false,
          priceInverted: true,
        },
        depositState: {
          exactAmounts: {
            [PositionField.TOKEN0]: '100',
            [PositionField.TOKEN1]: '200',
          },
          exactField: PositionField.TOKEN0,
        },
      },
      vi.fn(),
    ])
    const { result } = renderHook(() => useLiquidityUrlState())

    // Verify all expected fields are present
    expect(result.current).toHaveProperty('tokenA')
    expect(result.current).toHaveProperty('tokenB')
    expect(result.current).toHaveProperty('fee')
    expect(result.current).toHaveProperty('hook')
    expect(result.current).toHaveProperty('priceRangeState')
    expect(result.current).toHaveProperty('depositState')
    expect(result.current).toHaveProperty('flowStep')
    expect(result.current).toHaveProperty('chainId')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('setHistoryState')
    expect(result.current).toHaveProperty('syncToUrl')

    // Verify specific values
    expect(result.current.tokenA).toEqual(defaultErc20Token)
    expect(result.current.fee?.feeAmount).toBe(3000)
    expect(result.current.hook).toBe('0x0000000000000000000000000000000000000001')
    expect(result.current.priceRangeState.minTick).toBe(0)
    expect(result.current.priceRangeState.maxTick).toBe(1)
    expect(result.current.priceRangeState.initialPrice).toBe('1.5')
    expect(result.current.priceRangeState.fullRange).toBe(false)
    expect(result.current.priceRangeState.priceInverted).toBe(true)
    expect(result.current.depositState.exactAmounts?.[PositionField.TOKEN0]).toBe('100')
    expect(result.current.flowStep).toBe(PositionFlowStep.PRICE_RANGE)
    expect(result.current.chainId).toBe(UniverseChainId.Gnosis)
  })

  it('provides setHistoryState function for step navigation', () => {
    const mockSetStep = vi.fn()
    useQueryStateMock.mockReturnValue([PositionFlowStep.SELECT_TOKENS_AND_FEE_TIER, mockSetStep])
    const { result } = renderHook(() => useLiquidityUrlState())

    expect(typeof result.current.setHistoryState).toBe('function')
    expect(result.current.setHistoryState).toBe(mockSetStep)
  })

  it('provides syncToUrl function for form state synchronization', () => {
    const { result } = renderHook(() => useLiquidityUrlState())

    expect(typeof result.current.syncToUrl).toBe('function')

    // Test that syncToUrl can be called without errors
    const mockData = {
      currencyInputs: { tokenA: defaultErc20Token, tokenB: undefined },
      positionState: { fee: DEFAULT_FEE_DATA, hook: undefined },
      priceRangeState: { fullRange: true },
      depositState: { exactField: PositionField.TOKEN0, exactAmounts: {} },
    }

    expect(() => result.current.syncToUrl(mockData)).not.toThrow()
  })

  describe('backwards compatibility', () => {
    it('handles currencya and currencyb', () => {
      useQueryStatesMock.mockReturnValue([
        {
          currencya: NATIVE_CHAIN_ID,
          currencyb: defaultErc20Token.address,
          chain: null,
          fee: DEFAULT_FEE_DATA,
          hook: null,
          priceRangeState: {},
          depositState: {},
        },
        vi.fn(),
      ])
      const { result, rerender } = renderHook(() => useLiquidityUrlState())
      rerender()
      expect(result.current.tokenA).toEqual(defaultInitialToken)
      expect(result.current.tokenB).toEqual(defaultErc20Token)
    })

    it('handles feeTier and isDynamic', () => {
      const mockSetReplaceState = vi.fn()
      useQueryStatesMock.mockReturnValue([
        {
          feeTier: '500',
          isDynamic: 'true',
          currencyA: '',
          currencyB: '',
          chain: null,
          hook: null,
          priceRangeState: {},
          depositState: {},
        },
        mockSetReplaceState,
      ])

      renderHook(() => useLiquidityUrlState())

      expect(mockSetReplaceState).toHaveBeenCalledWith({
        fee: {
          feeAmount: 500,
          tickSpacing: 10,
          isDynamic: true,
        },
        chain: null,
        hook: null,
        priceRangeState: {},
        depositState: {},
        currencyA: '',
        currencyB: '',
        isDynamic: null,
        feeTier: null,
      })
    })
  })
})
