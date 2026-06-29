import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { selectTransaction } from 'uniswap/src/features/transactions/selectors'
import store from '~/state'

/**
 * Utility function to check if a transaction exists in the Redux store.
 * This is meant to be used outside of React components where hooks are not available.
 *
 * @param params - Object containing from address, chainId, and transaction id
 * @returns true if the transaction exists, false otherwise
 */
export function isExistingTransaction(params: { from: string; chainId: UniverseChainId; id: string }): boolean {
  const state = store.getState()
  return Boolean(selectTransaction(state, { address: params.from, chainId: params.chainId, txId: params.id }))
}
