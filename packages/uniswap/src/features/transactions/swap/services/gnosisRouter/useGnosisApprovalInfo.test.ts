import { useQuery } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { GNOSIS_AGGREGATION_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter'
import { PERMIT2_ADDRESS, erc20Interface } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/approvals'
import {
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_SDAI,
  GNOSIS_SDAI_ADAPTER_ADDRESS,
  GNOSIS_USDCE,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { GNOSIS_SDAI_ADAPTER_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import { GNOSIS_SDAI_ZAP_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiZap'
import {
  getGnosisApprovalTokenAddressOverride,
  useGnosisApprovalInfo,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/useGnosisApprovalInfo'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import type { Mock } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

vi.mock('uniswap/src/features/gas/hooks', () => ({
  convertGasFeeToDisplayValue: vi.fn(({ gasFee }: { gasFee: string }) => gasFee),
  useActiveGasStrategy: vi.fn(() => ({})),
}))

describe('useGnosisApprovalInfo', () => {
  const owner = '0x1111111111111111111111111111111111111111'
  const tokenIn = new Token(UniverseChainId.Gnosis, '0x1000000000000000000000000000000000000001', 18, 'TST')
  const tokenOut = new Token(UniverseChainId.Gnosis, '0x2000000000000000000000000000000000000002', 18, 'OUT')
  const wxdai = new Token(UniverseChainId.Gnosis, GNOSIS_WXDAI, 18, 'WXDAI')
  const sdai = new Token(UniverseChainId.Gnosis, GNOSIS_SDAI, 18, 'sDAI')
  const gbpe = new Token(UniverseChainId.Gnosis, GNOSIS_GBPE_V2, 18, 'GBPe')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds the ERC20 approval for the exact input amount', () => {
    ;(useQuery as Mock).mockReturnValue({
      data: { allowance: '0', gasPrice: '10' },
      isLoading: false,
      error: null,
    })

    const { result } = renderHook(() =>
      useGnosisApprovalInfo({
        address: owner,
        chainId: UniverseChainId.Gnosis,
        wrapType: WrapType.NotApplicable,
        currencyInAmount: CurrencyAmount.fromRawAmount(tokenIn, '12345'),
        currencyOutAmount: CurrencyAmount.fromRawAmount(tokenOut, '1'),
        tradeType: TradingApi.TradeType.EXACT_INPUT,
      }),
    )

    const txRequest = result.current.tokenApprovalInfo.txRequest
    expect(result.current.tokenApprovalInfo.action).toBe(ApprovalAction.Permit2Approve)
    expect(txRequest?.to).toBe(tokenIn.address)
    const decoded = erc20Interface.decodeFunctionData('approve', txRequest?.data ?? '')
    expect(decoded[0]).toBe(PERMIT2_ADDRESS)
    expect(decoded[1].toString()).toBe('12345')
  })

  it('uses the concrete execution token override for shared-state input approvals', () => {
    ;(useQuery as Mock).mockReturnValue({
      data: { allowance: '0', gasPrice: '10' },
      isLoading: false,
      error: null,
    })

    const { result } = renderHook(() =>
      useGnosisApprovalInfo({
        address: owner,
        chainId: UniverseChainId.Gnosis,
        wrapType: WrapType.NotApplicable,
        currencyInAmount: CurrencyAmount.fromRawAmount(gbpe, '12345'),
        currencyOutAmount: CurrencyAmount.fromRawAmount(tokenOut, '1'),
        tradeType: TradingApi.TradeType.EXACT_INPUT,
        tokenAddressOverride: GNOSIS_GBPE_V1,
      }),
    )

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['gnosisErc20Allowance', UniverseChainId.Gnosis, owner, GNOSIS_GBPE_V1, PERMIT2_ADDRESS],
      }),
    )
    const txRequest = result.current.tokenApprovalInfo.txRequest
    expect(txRequest?.to).toBe(GNOSIS_GBPE_V1)
    const decoded = erc20Interface.decodeFunctionData('approve', txRequest?.data ?? '')
    expect(decoded[0]).toBe(PERMIT2_ADDRESS)
    expect(decoded[1].toString()).toBe('12345')
  })

  it('builds the ERC20 approval for the max input amount on exact-output swaps', () => {
    ;(useQuery as Mock).mockReturnValue({
      data: { allowance: '12345', gasPrice: '10' },
      isLoading: false,
      error: null,
    })

    const { result } = renderHook(() =>
      useGnosisApprovalInfo({
        address: owner,
        chainId: UniverseChainId.Gnosis,
        wrapType: WrapType.NotApplicable,
        currencyInAmount: CurrencyAmount.fromRawAmount(tokenIn, '12345'),
        currencyInApprovalAmount: CurrencyAmount.fromRawAmount(tokenIn, '12406'),
        currencyOutAmount: CurrencyAmount.fromRawAmount(tokenOut, '1000'),
        tradeType: TradingApi.TradeType.EXACT_OUTPUT,
      }),
    )

    const txRequest = result.current.tokenApprovalInfo.txRequest
    expect(result.current.tokenApprovalInfo.action).toBe(ApprovalAction.Permit2Approve)
    const decoded = erc20Interface.decodeFunctionData('approve', txRequest?.data ?? '')
    expect(decoded[0]).toBe(PERMIT2_ADDRESS)
    expect(decoded[1].toString()).toBe('12406')
  })

  it('uses Permit2 for sDAI adapter-eligible pairs until the selected quote is an adapter quote', () => {
    ;(useQuery as Mock).mockReturnValue({
      data: { allowance: '0', gasPrice: '10' },
      isLoading: false,
      error: null,
    })

    const { result } = renderHook(() =>
      useGnosisApprovalInfo({
        address: owner,
        chainId: UniverseChainId.Gnosis,
        wrapType: WrapType.NotApplicable,
        currencyInAmount: CurrencyAmount.fromRawAmount(wxdai, '12345'),
        currencyOutAmount: CurrencyAmount.fromRawAmount(sdai, '1'),
        tradeType: TradingApi.TradeType.EXACT_INPUT,
        quoteId: 'gnosis-local',
      }),
    )

    const decoded = erc20Interface.decodeFunctionData('approve', result.current.tokenApprovalInfo.txRequest?.data ?? '')
    expect(decoded[0]).toBe(PERMIT2_ADDRESS)
  })

  it('uses the sDAI adapter spender for selected adapter quotes', () => {
    ;(useQuery as Mock).mockReturnValue({
      data: { allowance: '0', gasPrice: '10' },
      isLoading: false,
      error: null,
    })

    const { result } = renderHook(() =>
      useGnosisApprovalInfo({
        address: owner,
        chainId: UniverseChainId.Gnosis,
        wrapType: WrapType.NotApplicable,
        currencyInAmount: CurrencyAmount.fromRawAmount(wxdai, '12345'),
        currencyOutAmount: CurrencyAmount.fromRawAmount(sdai, '1'),
        tradeType: TradingApi.TradeType.EXACT_INPUT,
        quoteId: GNOSIS_SDAI_ADAPTER_QUOTE_ID,
      }),
    )

    const decoded = erc20Interface.decodeFunctionData('approve', result.current.tokenApprovalInfo.txRequest?.data ?? '')
    expect(decoded[0]).toBe(GNOSIS_SDAI_ADAPTER_ADDRESS)
  })
})

describe('getGnosisApprovalTokenAddressOverride', () => {
  function quote(overrides: Partial<TradingApi.ClassicQuote> = {}): TradingApi.ClassicQuote {
    return {
      chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      swapper: '0x1111111111111111111111111111111111111111',
      input: { token: GNOSIS_GBPE_V2, amount: '12345' },
      output: { token: GNOSIS_USDCE, amount: '1', recipient: '0x1111111111111111111111111111111111111111' },
      tradeType: TradingApi.TradeType.EXACT_INPUT,
      slippage: 0.5,
      quoteId: 'gnosis-local',
      gasUseEstimate: '100000',
      priceImpact: 0,
      portionBips: 0,
      route: [],
      routeString: '',
      ...overrides,
    }
  }

  it('returns the aggregation execution input token for aggregation quotes', () => {
    expect(
      getGnosisApprovalTokenAddressOverride(
        quote({
          quoteId: GNOSIS_AGGREGATION_QUOTE_ID,
          aggregation: {
            tokenIn: GNOSIS_GBPE_V1,
            tokenOut: GNOSIS_USDCE,
            legs: [{ amountIn: '12345', steps: [], label: 'test' }],
          },
        } as Partial<TradingApi.ClassicQuote>),
      ),
    ).toBe(GNOSIS_GBPE_V1)
  })

  it('returns the first concrete route input token for plain V3 quotes', () => {
    expect(
      getGnosisApprovalTokenAddressOverride(
        quote({
          route: [
            [
              {
                type: 'v3-pool',
                address: '0x2222222222222222222222222222222222222222',
                tokenIn: {
                  address: GNOSIS_GBPE_V1,
                  chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
                  symbol: 'GBPe',
                  decimals: '18',
                },
                tokenOut: {
                  address: GNOSIS_USDCE,
                  chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
                  symbol: 'USDC.e',
                  decimals: '6',
                },
                fee: '500',
                liquidity: '1',
                sqrtRatioX96: '1',
                tickCurrent: '0',
                amountIn: '12345',
                amountOut: '1',
              },
            ],
          ],
        }),
      ),
    ).toBe(GNOSIS_GBPE_V1)
  })

  it('leaves adapter and zap quotes on their top-level input token', () => {
    expect(
      getGnosisApprovalTokenAddressOverride(
        quote({
          quoteId: GNOSIS_SDAI_ADAPTER_QUOTE_ID,
          route: [
            [
              {
                type: 'v3-pool',
                address: '0x2222222222222222222222222222222222222222',
                tokenIn: {
                  address: GNOSIS_SDAI,
                  chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
                  symbol: 'sDAI',
                  decimals: '18',
                },
                tokenOut: {
                  address: GNOSIS_USDCE,
                  chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
                  symbol: 'USDC.e',
                  decimals: '6',
                },
                fee: '500',
                liquidity: '1',
                sqrtRatioX96: '1',
                tickCurrent: '0',
                amountIn: '12345',
                amountOut: '1',
              },
            ],
          ],
        }),
      ),
    ).toBeUndefined()
    expect(getGnosisApprovalTokenAddressOverride(quote({ quoteId: GNOSIS_SDAI_ZAP_QUOTE_ID }))).toBeUndefined()
  })
})
