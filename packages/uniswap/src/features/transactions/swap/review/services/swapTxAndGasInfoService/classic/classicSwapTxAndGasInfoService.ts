import type { GasStrategy } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { TransactionSettings } from 'uniswap/src/features/transactions/components/settings/types'
import type { EVMSwapInstructionsService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/evmSwapInstructionsService'
import { createGetEVMSwapTransactionRequestInfo } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/utils'
import type { SwapTxAndGasInfoService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/swapTxAndGasInfoService'
import {
  createGetPermitTxInfo,
  getClassicSwapTxAndGasInfo,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/utils'
import {
  type ClassicSwapTxAndGasInfo,
  PermitMethod,
} from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import type { ClassicTrade } from 'uniswap/src/features/transactions/swap/types/trade'
import type {
  PopulatedTransactionRequestArray,
  ValidatedTransactionRequest,
} from 'uniswap/src/features/transactions/types/transactionRequests'

/**
 * Gnosis builds its swap tx client-side (UniversalRouter / SdaiZapRouter), so unlike other
 * chains it never gets the Trading API's `/swap_5792` response that bundles the whole swap.
 * Its pieces therefore stay as up to three sequential txs: the ERC20 `approve` -> Permit2, the
 * Permit2 `approve` -> UniversalRouter (a real tx, because a Safe can't produce the off-chain
 * typed-data permit), and the swap. When the connected wallet supports EIP-5792 atomic batching
 * (e.g. a Safe over WalletConnect), fold the approval and the permit tx into `txRequests` so the
 * existing wallet-call step submits them as a single `wallet_sendCalls` instead of separate
 * prompts. The folded txs are byte-identical to the sequential ones, so EOAs (no batching
 * capability) keep the exact current flow. A typed-data permit is an off-chain signature that
 * can't go inside a tx batch, so leave the flow untouched in that case.
 */
export function batchGnosisApprovalIntoSwap({
  result,
  getCanBatchTransactions,
}: {
  result: ClassicSwapTxAndGasInfo
  getCanBatchTransactions?: (chainId: UniverseChainId | undefined) => boolean
}): ClassicSwapTxAndGasInfo {
  const chainId = result.trade?.inputAmount.currency.chainId
  if (
    chainId !== UniverseChainId.Gnosis ||
    !getCanBatchTransactions?.(chainId) ||
    !result.txRequests?.length ||
    result.permit?.method === PermitMethod.TypedData
  ) {
    return result
  }

  const permitTxRequest = result.permit?.method === PermitMethod.Transaction ? result.permit.txRequest : undefined
  if (!result.approveTxRequest && !permitTxRequest) {
    return result
  }

  const prefix: ValidatedTransactionRequest[] = []
  if (result.approveTxRequest) {
    prefix.push(result.approveTxRequest)
  }
  if (permitTxRequest) {
    prefix.push(permitTxRequest)
  }

  return {
    ...result,
    // Non-empty because `result.txRequests` is non-empty (guarded above).
    txRequests: [...prefix, ...result.txRequests] as PopulatedTransactionRequestArray,
    approveTxRequest: undefined,
    permit: undefined,
  }
}

export function createClassicSwapTxAndGasInfoService(ctx: {
  instructionService: EVMSwapInstructionsService
  gasStrategy: GasStrategy
  transactionSettings: TransactionSettings
  hasOverrides?: boolean
  getCanBatchTransactions?: (chainId: UniverseChainId | undefined) => boolean
}): SwapTxAndGasInfoService<ClassicTrade> {
  const getEVMSwapTransactionRequestInfo = createGetEVMSwapTransactionRequestInfo(ctx)
  const getPermitTxInfo = createGetPermitTxInfo(ctx)

  const service: SwapTxAndGasInfoService<ClassicTrade> = {
    async getSwapTxAndGasInfo(params) {
      const swapTxInfo = await getEVMSwapTransactionRequestInfo(params)
      const permitTxInfo = getPermitTxInfo(params.trade)

      const result = getClassicSwapTxAndGasInfo({ ...params, swapTxInfo, permitTxInfo })
      return batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: ctx.getCanBatchTransactions })
    },
  }

  return service
}
