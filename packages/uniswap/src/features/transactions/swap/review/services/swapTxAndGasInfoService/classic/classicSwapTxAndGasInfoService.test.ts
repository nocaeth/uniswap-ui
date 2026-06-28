import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { batchGnosisApprovalIntoSwap } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/classic/classicSwapTxAndGasInfoService'
import type { ClassicSwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import type { ValidatedTransactionRequest } from 'uniswap/src/features/transactions/types/transactionRequests'

const APPROVE = { to: '0xToken', chainId: 100, data: '0xapprove' } as ValidatedTransactionRequest
const SWAP = { to: '0xRouter', chainId: 100, data: '0xswap' } as ValidatedTransactionRequest

function makeResult({
  chainId,
  approveTxRequest,
  txRequests,
}: {
  chainId: number
  approveTxRequest: ValidatedTransactionRequest | undefined
  txRequests: ValidatedTransactionRequest[] | undefined
}): ClassicSwapTxAndGasInfo {
  return {
    trade: { inputAmount: { currency: { chainId } } },
    approveTxRequest,
    txRequests,
  } as unknown as ClassicSwapTxAndGasInfo
}

const canBatch = (): boolean => true
const cannotBatch = (): boolean => false

describe('batchGnosisApprovalIntoSwap', () => {
  it('folds the approval into txRequests for Gnosis when batching is supported', () => {
    const result = makeResult({ chainId: UniverseChainId.Gnosis, approveTxRequest: APPROVE, txRequests: [SWAP] })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: canBatch })
    // [approve, swap] go out as one wallet_sendCalls; the separate approval step is dropped.
    expect(out.txRequests).toEqual([APPROVE, SWAP])
    expect(out.approveTxRequest).toBeUndefined()
  })

  it('keeps approval and swap as separate txs when batching is unsupported (EOA)', () => {
    const result = makeResult({ chainId: UniverseChainId.Gnosis, approveTxRequest: APPROVE, txRequests: [SWAP] })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: cannotBatch })
    expect(out.txRequests).toEqual([SWAP])
    expect(out.approveTxRequest).toBe(APPROVE)
  })

  it('does not fold when no approval is needed', () => {
    const result = makeResult({ chainId: UniverseChainId.Gnosis, approveTxRequest: undefined, txRequests: [SWAP] })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: canBatch })
    expect(out.txRequests).toEqual([SWAP])
    expect(out.approveTxRequest).toBeUndefined()
  })

  it('does not fold for non-Gnosis chains', () => {
    const result = makeResult({ chainId: UniverseChainId.Mainnet, approveTxRequest: APPROVE, txRequests: [SWAP] })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: canBatch })
    expect(out.txRequests).toEqual([SWAP])
    expect(out.approveTxRequest).toBe(APPROVE)
  })

  it('does not fold when no batching capability function is provided', () => {
    const result = makeResult({ chainId: UniverseChainId.Gnosis, approveTxRequest: APPROVE, txRequests: [SWAP] })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: undefined })
    expect(out.txRequests).toEqual([SWAP])
    expect(out.approveTxRequest).toBe(APPROVE)
  })
})
