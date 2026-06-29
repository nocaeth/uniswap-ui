import type { TransactionRequest } from '@ethersproject/abstract-provider'
import { call, put, select, take } from 'typed-redux-saga'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { cancelTransaction, TransactionsState, updateTransaction } from 'uniswap/src/features/transactions/slice'
import { TransactionStatus } from 'uniswap/src/features/transactions/types/transactionDetails'
import { logger } from 'utilities/src/logger/logger'
import { getSigner } from '~/state/sagas/transactions/utils'

interface CancelOrderPayload {
  chainId: UniverseChainId
  id: string
  address: string
  cancelRequest: TransactionRequest
}

/**
 * Saga that watches for `cancelTransaction` Redux actions on web and submits the
 * cancellation transaction on-chain.
 *
 * For UniswapX orders, this submits a permit2 nonce invalidation transaction.
 * For classic/bridge transactions, this submits a replacement transaction.
 *
 * This is the web equivalent of the mobile `cancelTransactionSaga` in
 * `packages/wallet/src/features/transactions/cancelTransactionSaga.ts`.
 */
export function* cancelOrderSaga() {
  while (true) {
    const { payload } = yield* take<ReturnType<typeof cancelTransaction>>(cancelTransaction.type)
    yield* call(handleCancelOrder, payload)
  }
}

function* updateFailedCancellationStatus({
  address,
  chainId,
  id,
}: {
  address: string
  chainId: UniverseChainId
  id: string
}) {
  const transaction = yield* select(
    (state: { transactions: TransactionsState }) => state.transactions[address]?.[chainId]?.[id],
  )

  if (!transaction || transaction.status !== TransactionStatus.Cancelling) {
    return
  }
  yield* put(
    updateTransaction({
      ...transaction,
      status: TransactionStatus.FailedCancel,
    }),
  )
}

export function* handleCancelOrder(payload: CancelOrderPayload) {
  const { cancelRequest, address, chainId } = payload

  try {
    const signer = yield* call(getSigner, address)

    logger.debug('cancelOrderSaga', 'handleCancelOrder', 'Submitting cancellation transaction', {
      chainId,
      id: payload.id,
    })

    const response = yield* call(() => signer.sendTransaction(cancelRequest))

    logger.debug('cancelOrderSaga', 'handleCancelOrder', 'Cancellation transaction submitted', {
      chainId,
      id: payload.id,
      hash: response.hash,
    })

    // The order poller will pick up the status change from the backend
    // (cancelled or filled) and update the transaction in Redux state.
    // No need to manually update the transaction status here.
  } catch (error) {
    yield* updateFailedCancellationStatus({ address, chainId, id: payload.id })
    logger.error(error, {
      tags: { file: 'cancelOrderSaga', function: 'handleCancelOrder' },
      extra: { chainId, id: payload.id },
    })
  }
}
