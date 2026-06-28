import { GraphQLApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChartDataChainId } from '~/pages/PoolDetails/components/ChartSection/getChartDataChainId'

describe('getChartDataChainId', () => {
  it('prefers the actual page chain id over the backend GraphQL chain enum', () => {
    expect(
      getChartDataChainId({
        chainId: UniverseChainId.Gnosis,
        backendChain: GraphQLApi.Chain.Ethereum,
        defaultChainId: UniverseChainId.Mainnet,
      }),
    ).toBe(UniverseChainId.Gnosis)
  })

  it('falls back to the backend GraphQL chain when no page chain id is provided', () => {
    expect(
      getChartDataChainId({
        backendChain: GraphQLApi.Chain.Arbitrum,
        defaultChainId: UniverseChainId.Mainnet,
      }),
    ).toBe(UniverseChainId.ArbitrumOne)
  })

  it('falls back to the default chain when no chain can be resolved', () => {
    expect(
      getChartDataChainId({
        backendChain: GraphQLApi.Chain.UnknownChain,
        defaultChainId: UniverseChainId.Gnosis,
      }),
    ).toBe(UniverseChainId.Gnosis)
  })
})
