import { GraphQLApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { fromGraphQLChain, isBackendSupportedChainId } from 'uniswap/src/features/chains/utils'

export function supportedChainIdFromGQLChain(chain: GraphQLApi.Chain | string): UniverseChainId | undefined {
  const chainId = fromGraphQLChain(chain) ?? undefined
  return chainId && isBackendSupportedChainId(chainId) ? chainId : undefined
}
