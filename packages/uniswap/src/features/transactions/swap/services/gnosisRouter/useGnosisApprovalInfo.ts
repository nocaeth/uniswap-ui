import { BigNumber } from '@ethersproject/bignumber'
import { useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { useMemo } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { convertGasFeeToDisplayValue, useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import type { ApprovalTxInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import {
  getGnosisAggregationApprovalSpender,
  isGnosisAggregationQuote,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter'
import {
  buildErc20ApproveData,
  PERMIT2_ADDRESS,
  readErc20Allowance,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/approvals'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import {
  GNOSIS_SDAI_ADAPTER_QUOTE_ID,
  getGnosisSdaiAdapterApprovalSpender,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import {
  GNOSIS_SDAI_ZAP_QUOTE_ID,
  getGnosisSdaiZapApprovalSpender,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiZap'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { ONE_MINUTE_MS, ONE_SECOND_MS } from 'utilities/src/time/time'

// Static gas allowance (gas units) for the ERC20 approve tx, used for the
// network-cost estimate (the wallet re-estimates at submission).
const ERC20_APPROVE_GAS = 55_000

export function getGnosisApprovalTokenAddressOverride(quote: TradingApi.ClassicQuote | undefined): string | undefined {
  if (!quote || quote.quoteId === GNOSIS_SDAI_ADAPTER_QUOTE_ID || quote.quoteId === GNOSIS_SDAI_ZAP_QUOTE_ID) {
    return undefined
  }
  if (isGnosisAggregationQuote(quote)) {
    return quote.aggregation.tokenIn
  }
  return quote.route?.[0]?.[0]?.tokenIn?.address
}

/**
 * Client-side ERC20 approval status for Gnosis, replacing the Trading API's `checkApproval`
 * (which doesn't serve Gnosis). Normal V3 swaps approve Permit2; direct sDAI adapter swaps
 * approve the adapter. The Permit2 → UniversalRouter step is handled separately via the
 * quote's `permitTransaction` (see fetchGnosisQuote).
 */
export function useGnosisApprovalInfo(params: {
  address?: string
  chainId: UniverseChainId
  wrapType: WrapType
  currencyInAmount: Maybe<CurrencyAmount<Currency>>
  currencyInApprovalAmount?: Maybe<CurrencyAmount<Currency>>
  currencyOutAmount?: Maybe<CurrencyAmount<Currency>>
  tradeType?: TradingApi.TradeType
  quoteId?: string
  tokenAddressOverride?: string
}): ApprovalTxInfo {
  const {
    address,
    chainId,
    wrapType,
    currencyInAmount,
    currencyInApprovalAmount,
    currencyOutAmount,
    tradeType,
    quoteId,
    tokenAddressOverride,
  } = params

  const currencyIn = currencyInApprovalAmount?.currency ?? currencyInAmount?.currency
  const currencyOut = currencyOutAmount?.currency
  const isWrap = wrapType !== WrapType.NotApplicable
  const isNative = Boolean(currencyIn?.isNative)
  const tokenAddress = tokenAddressOverride ?? currencyIn?.wrapped.address
  const tokenInAddressForRoute = currencyIn?.isNative ? '0x0000000000000000000000000000000000000000' : tokenAddress
  const tokenOutAddressForRoute = currencyOut?.isNative
    ? '0x0000000000000000000000000000000000000000'
    : currencyOut?.wrapped.address
  // Approval spender must match the emitted quote, not just quote eligibility: zap quotes can fall
  // back to UniversalRouter/Permit2 when the sDAI-rooted sub-route is unusable.
  const zapApprovalSpender =
    quoteId === GNOSIS_SDAI_ZAP_QUOTE_ID
      ? getGnosisSdaiZapApprovalSpender({
          tokenIn: tokenInAddressForRoute,
          tokenOut: tokenOutAddressForRoute,
          tradeType: tradeType ?? TradingApi.TradeType.EXACT_INPUT,
        })
      : undefined
  const adapterApprovalSpender =
    quoteId === GNOSIS_SDAI_ADAPTER_QUOTE_ID
      ? getGnosisSdaiAdapterApprovalSpender({ tokenIn: tokenInAddressForRoute, tokenOut: tokenOutAddressForRoute })
      : undefined
  const aggregationApprovalSpender = getGnosisAggregationApprovalSpender(quoteId)
  const approvalSpender = zapApprovalSpender ?? adapterApprovalSpender ?? aggregationApprovalSpender ?? PERMIT2_ADDRESS
  const requiredAmount = (currencyInApprovalAmount ?? currencyInAmount)?.quotient.toString()

  const gasStrategy = useActiveGasStrategy(chainId, 'general')

  const enabled =
    chainId === UniverseChainId.Gnosis && Boolean(address) && Boolean(tokenAddress) && !isNative && !isWrap

  const { data, isLoading, error } = useQuery({
    queryKey: ['gnosisErc20Allowance', chainId, address, tokenAddress, approvalSpender],
    enabled,
    staleTime: 15 * ONE_SECOND_MS,
    gcTime: ONE_MINUTE_MS,
    queryFn: async (): Promise<{ allowance: string; gasPrice: string }> => {
      const [allowance, gasPrice] = await Promise.all([
        readErc20Allowance({ owner: address as string, token: tokenAddress as string, spender: approvalSpender }),
        getGnosisProvider().getGasPrice(),
      ])
      return { allowance: allowance.toString(), gasPrice: gasPrice.toString() }
    },
  })

  return useMemo(() => {
    const noApprovalBase = {
      approvalGasFeeResult: {
        value: '0',
        displayValue: convertGasFeeToDisplayValue({ gasFee: '0', gasStrategy }),
        isLoading: false,
        error: null,
      },
      revokeGasFeeResult: {
        value: '0',
        displayValue: convertGasFeeToDisplayValue({ gasFee: '0', gasStrategy }),
        isLoading: false,
        error: null,
      },
    }

    // Native input, wraps and unconnected state never need an approval.
    if (isNative || isWrap || !address || !tokenAddress || !requiredAmount) {
      return {
        tokenApprovalInfo: { action: ApprovalAction.None, txRequest: null, cancelTxRequest: null },
        ...noApprovalBase,
      }
    }

    if (isLoading || !data) {
      // Block submission UI until allowance is known (mirrors the Trading API "Unknown" gate).
      return {
        tokenApprovalInfo: { action: ApprovalAction.Unknown, txRequest: null, cancelTxRequest: null },
        approvalGasFeeResult: { value: undefined, displayValue: undefined, isLoading, error: error ?? null },
        revokeGasFeeResult: { value: '0', displayValue: '0', isLoading: false, error: null },
      }
    }

    const sufficient = BigNumber.from(data.allowance).gte(BigNumber.from(requiredAmount))
    if (sufficient) {
      return {
        tokenApprovalInfo: { action: ApprovalAction.None, txRequest: null, cancelTxRequest: null },
        ...noApprovalBase,
      }
    }

    const approvalFee = BigNumber.from(ERC20_APPROVE_GAS).mul(BigNumber.from(data.gasPrice)).toString()
    return {
      tokenApprovalInfo: {
        action: ApprovalAction.Permit2Approve,
        txRequest: {
          to: tokenAddress,
          from: address,
          chainId,
          data: buildErc20ApproveData(approvalSpender, BigNumber.from(requiredAmount)),
        },
        cancelTxRequest: null,
      },
      approvalGasFeeResult: {
        value: approvalFee,
        displayValue: convertGasFeeToDisplayValue({ gasFee: approvalFee, gasStrategy }),
        isLoading: false,
        error: null,
      },
      revokeGasFeeResult: {
        value: '0',
        displayValue: convertGasFeeToDisplayValue({ gasFee: '0', gasStrategy }),
        isLoading: false,
        error: null,
      },
    }
  }, [
    address,
    approvalSpender,
    chainId,
    data,
    error,
    gasStrategy,
    isLoading,
    isNative,
    isWrap,
    requiredAmount,
    tokenAddress,
  ])
}
