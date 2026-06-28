import { BigNumber } from '@ethersproject/bignumber'
import { useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { useMemo } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { convertGasFeeToDisplayValue, useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import type { ApprovalTxInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import {
  buildErc20ApproveData,
  PERMIT2_ADDRESS,
  readErc20Allowance,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/approvals'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import { getGnosisSdaiAdapterApprovalSpender } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import { getGnosisSdaiZapApprovalSpender } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiZap'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { ONE_MINUTE_MS, ONE_SECOND_MS } from 'utilities/src/time/time'

// Static gas allowance (gas units) for the ERC20 approve tx, used for the
// network-cost estimate (the wallet re-estimates at submission).
const ERC20_APPROVE_GAS = 55_000

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
  currencyOutAmount?: Maybe<CurrencyAmount<Currency>>
  tradeType?: TradingApi.TradeType
}): ApprovalTxInfo {
  const { address, chainId, wrapType, currencyInAmount, currencyOutAmount, tradeType } = params

  const currencyIn = currencyInAmount?.currency
  const currencyOut = currencyOutAmount?.currency
  const isWrap = wrapType !== WrapType.NotApplicable
  const isNative = Boolean(currencyIn?.isNative)
  const tokenAddress = currencyIn?.wrapped.address
  const tokenInAddressForRoute = currencyIn?.isNative ? '0x0000000000000000000000000000000000000000' : tokenAddress
  const tokenOutAddressForRoute = currencyOut?.isNative
    ? '0x0000000000000000000000000000000000000000'
    : currencyOut?.wrapped.address
  // Resolved the same way the quoter decides to use the zap (shared eligibility), so the approved
  // spender always matches the route that executes: zap > adapter > Permit2.
  const zapApprovalSpender = getGnosisSdaiZapApprovalSpender({
    tokenIn: tokenInAddressForRoute,
    tokenOut: tokenOutAddressForRoute,
    tradeType: tradeType ?? TradingApi.TradeType.EXACT_INPUT,
  })
  const approvalSpender =
    zapApprovalSpender ??
    getGnosisSdaiAdapterApprovalSpender({ tokenIn: tokenInAddressForRoute, tokenOut: tokenOutAddressForRoute }) ??
    PERMIT2_ADDRESS
  const requiredAmount = currencyInAmount?.quotient.toString()

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
          data: buildErc20ApproveData(approvalSpender),
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
