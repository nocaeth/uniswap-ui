import { GraphQLApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { TokenQueryData } from '~/appGraphql/data/Token'
import { getTDPChartGraphqlTarget } from '~/pages/TokenDetails/hooks/getTDPChartGraphqlTarget'

describe('getTDPChartGraphqlTarget', () => {
  const pathChain = GraphQLApi.Chain.Ethereum
  const pathAddress = '0xPath'

  it('uses path when no network is selected', () => {
    expect(
      getTDPChartGraphqlTarget({
        selectedMultichainChainId: undefined,
        tokenQueryData: { project: { tokens: [] } } as unknown as TokenQueryData,
        pathGraphqlChain: pathChain,
        pathChainId: UniverseChainId.Mainnet,
        pathTokenDbAddress: pathAddress,
      }),
    ).toEqual({ chain: pathChain, chainId: UniverseChainId.Mainnet, address: pathAddress })
  })

  it('uses project deployment when a network is selected', () => {
    const tokenQueryData = {
      project: {
        tokens: [
          { chain: GraphQLApi.Chain.Ethereum, address: '0xeth' },
          { chain: GraphQLApi.Chain.Base, address: '0xbase' },
        ],
      },
    } as unknown as TokenQueryData

    expect(
      getTDPChartGraphqlTarget({
        selectedMultichainChainId: UniverseChainId.Base,
        tokenQueryData,
        pathGraphqlChain: pathChain,
        pathChainId: UniverseChainId.Mainnet,
        pathTokenDbAddress: pathAddress,
      }),
    ).toEqual({ chain: GraphQLApi.Chain.Base, chainId: UniverseChainId.Base, address: '0xbase' })
  })

  it('matches Gnosis response rows while returning the adapter request chain', () => {
    const tokenQueryData = {
      project: {
        tokens: [{ chain: 'GNOSIS', address: '0xgnosis' }],
      },
    } as unknown as TokenQueryData

    expect(
      getTDPChartGraphqlTarget({
        selectedMultichainChainId: UniverseChainId.Gnosis,
        tokenQueryData,
        pathGraphqlChain: pathChain,
        pathChainId: UniverseChainId.Mainnet,
        pathTokenDbAddress: pathAddress,
      }),
    ).toEqual({ chain: GraphQLApi.Chain.Ethereum, chainId: UniverseChainId.Gnosis, address: '0xgnosis' })
  })
})
