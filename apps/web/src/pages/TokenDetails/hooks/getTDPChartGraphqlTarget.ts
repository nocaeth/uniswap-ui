import { GraphQLApi } from '@universe/api'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { toGraphQLEntityChain } from 'uniswap/src/features/chains/utils'
import type { TokenQueryData } from '~/appGraphql/data/Token'
import { getNativeTokenDBAddress } from '~/utils/nativeTokens'

/** Chain + DB address for TDP chart queries, aligned with the network dropdown (`?chain=` → `selectedMultichainChainId`). */
export function getTDPChartGraphqlTarget({
  selectedMultichainChainId,
  tokenQueryData,
  pathGraphqlChain,
  pathChainId,
  pathTokenDbAddress,
}: {
  selectedMultichainChainId: UniverseChainId | undefined
  tokenQueryData: TokenQueryData | undefined
  pathGraphqlChain: GraphQLApi.Chain
  pathChainId: UniverseChainId
  pathTokenDbAddress: string | undefined
}): { chain: GraphQLApi.Chain; chainId: UniverseChainId; address: string | undefined } {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- biome-parity: oxlint is stricter here
  if (selectedMultichainChainId !== undefined && tokenQueryData?.project?.tokens?.length) {
    const requestChain = getChainInfo(selectedMultichainChainId).backendChain.chain
    const entityChain = toGraphQLEntityChain(selectedMultichainChainId)
    const row = tokenQueryData.project.tokens.find((t) => t.chain === entityChain)
    if (row) {
      const address =
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- biome-parity: oxlint is stricter here
        row.address !== undefined && row.address !== null ? row.address : getNativeTokenDBAddress(requestChain)
      return { chain: requestChain, chainId: selectedMultichainChainId, address }
    }
  }
  return { chain: pathGraphqlChain, chainId: pathChainId, address: pathTokenDbAddress }
}
