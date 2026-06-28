import { GraphQLApi } from '@universe/api'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { fromGraphQLChain } from 'uniswap/src/features/chains/utils'

export function getChartDataChainId({
  chainId,
  backendChain,
  defaultChainId,
}: {
  chainId?: UniverseChainId
  backendChain?: GraphQLApi.Chain | string
  defaultChainId: UniverseChainId
}): UniverseChainId {
  return chainId ?? fromGraphQLChain(backendChain) ?? defaultChainId
}
