import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { batchGnosisApprovalIntoSwap } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/classic/classicSwapTxAndGasInfoService'
import { type ClassicSwapTxAndGasInfo, PermitMethod } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import type { ValidatedTransactionRequest } from 'uniswap/src/features/transactions/types/transactionRequests'

const APPROVE = { to: '0xToken', chainId: 100, data: '0xapprove' } as ValidatedTransactionRequest
const PERMIT = { to: '0xPermit2', chainId: 100, data: '0xpermit' } as ValidatedTransactionRequest
const SWAP = { to: '0xRouter', chainId: 100, data: '0xswap' } as ValidatedTransactionRequest

const permitAsTransaction = { method: PermitMethod.Transaction, txRequest: PERMIT } as const
const permitAsTypedData = { method: PermitMethod.TypedData, typedData: {} } as unknown as ClassicSwapTxAndGasInfo['permit']

function makeResult({
  chainId,
  approveTxRequest,
  permit,
  txRequests,
}: {
  chainId: number
  approveTxRequest: ValidatedTransactionRequest | undefined
  permit?: ClassicSwapTxAndGasInfo['permit']
  txRequests: ValidatedTransactionRequest[] | undefined
}): ClassicSwapTxAndGasInfo {
  return {
    trade: { inputAmount: { currency: { chainId } } },
    approveTxRequest,
    permit,
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

  it('folds the approval AND the Permit2 permit tx in order [approve, permit, swap]', () => {
    const result = makeResult({
      chainId: UniverseChainId.Gnosis,
      approveTxRequest: APPROVE,
      permit: permitAsTransaction,
      txRequests: [SWAP],
    })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: canBatch })
    expect(out.txRequests).toEqual([APPROVE, PERMIT, SWAP])
    expect(out.approveTxRequest).toBeUndefined()
    expect(out.permit).toBeUndefined()
  })

  it('folds the permit tx even when the ERC20 approval is already in place', () => {
    const result = makeResult({
      chainId: UniverseChainId.Gnosis,
      approveTxRequest: undefined,
      permit: permitAsTransaction,
      txRequests: [SWAP],
    })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: canBatch })
    expect(out.txRequests).toEqual([PERMIT, SWAP])
    expect(out.permit).toBeUndefined()
  })

  it('does not fold a typed-data permit (off-chain signature cannot go in a tx batch)', () => {
    const result = makeResult({
      chainId: UniverseChainId.Gnosis,
      approveTxRequest: APPROVE,
      permit: permitAsTypedData,
      txRequests: [SWAP],
    })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: canBatch })
    expect(out.txRequests).toEqual([SWAP])
    expect(out.approveTxRequest).toBe(APPROVE)
    expect(out.permit).toBe(permitAsTypedData)
  })

  it('keeps approval and swap as separate txs when batching is unsupported (EOA)', () => {
    const result = makeResult({ chainId: UniverseChainId.Gnosis, approveTxRequest: APPROVE, txRequests: [SWAP] })
    const out = batchGnosisApprovalIntoSwap({ result, getCanBatchTransactions: cannotBatch })
    expect(out.txRequests).toEqual([SWAP])
    expect(out.approveTxRequest).toBe(APPROVE)
  })

  it('does not fold when no approval or permit is needed', () => {
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
