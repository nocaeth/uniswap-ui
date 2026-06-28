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
import type { ClassicSwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import type { ClassicTrade } from 'uniswap/src/features/transactions/swap/types/trade'

/**
 * Gnosis builds its swap tx client-side (UniversalRouter / SdaiZapRouter), so unlike other
 * chains it never gets the Trading API's `/swap_5792` response that bundles approval + swap.
 * Its approval and swap therefore stay as two sequential txs. When the connected wallet
 * supports EIP-5792 atomic batching (e.g. a Safe over WalletConnect), fold the approval into
 * `txRequests` so the existing wallet-call step submits `[approve, swap]` as a single
 * `wallet_sendCalls` instead of two prompts. The folded txs are byte-identical to the
 * sequential ones, so EOAs (no batching capability) keep the exact current flow.
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
    !result.approveTxRequest ||
    !result.txRequests?.length
  ) {
    return result
  }

  return {
    ...result,
    txRequests: [result.approveTxRequest, ...result.txRequests],
    approveTxRequest: undefined,
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
