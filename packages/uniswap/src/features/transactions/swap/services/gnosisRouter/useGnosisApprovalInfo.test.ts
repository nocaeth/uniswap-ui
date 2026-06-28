import { useQuery } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { PERMIT2_ADDRESS, erc20Interface } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/approvals'
import {
  GNOSIS_SDAI,
  GNOSIS_SDAI_ADAPTER_ADDRESS,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { GNOSIS_SDAI_ADAPTER_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import { useGnosisApprovalInfo } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/useGnosisApprovalInfo'
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
