import { GraphQLApi } from '@universe/api'
import type { MultichainTokenEntry } from 'uniswap/src/components/MultichainTokenDetails/useOrderedMultichainEntries'
import type { GqlEntityChainId } from 'uniswap/src/features/chains/types'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { PortfolioBalance } from 'uniswap/src/features/dataApi/types'
import type { MultiChainMap } from '~/pages/TokenDetails/context/TDPContext'
import { getHighestBalanceChain } from '~/pages/TokenDetails/hooks/getHighestBalanceChain'

const makeEntry = (chainId: UniverseChainId, address = '0x1'): MultichainTokenEntry => ({
  chainId,
  address,
  isNative: false,
})

const entries: MultichainTokenEntry[] = [
  makeEntry(UniverseChainId.Mainnet, '0xeth'),
  makeEntry(UniverseChainId.Base, '0xbase'),
  makeEntry(UniverseChainId.Polygon, '0xpoly'),
]

function buildMultiChainMap(balances: Partial<Record<GqlEntityChainId, number | null | undefined>>): MultiChainMap {
  const map: MultiChainMap = {}
  for (const [chain, balanceUSD] of Object.entries(balances)) {
    map[chain as GqlEntityChainId] = {
      address: '0x1',
      balance: balanceUSD != null ? ({ balanceUSD } as PortfolioBalance) : undefined,
    }
  }
  return map
}

describe('getHighestBalanceChain', () => {
  it('returns the entry with the highest balance', () => {
    const map = buildMultiChainMap({
      [GraphQLApi.Chain.Ethereum]: 100,
      [GraphQLApi.Chain.Base]: 5000,
      [GraphQLApi.Chain.Polygon]: 200,
    })
    expect(getHighestBalanceChain(map, entries)).toEqual(makeEntry(UniverseChainId.Base, '0xbase'))
  })

  it('matches Gnosis balances by the GNOSIS response key', () => {
    const gnosisEntry = makeEntry(UniverseChainId.Gnosis, '0xgnosis')
    const map = buildMultiChainMap({ GNOSIS: 1000, [GraphQLApi.Chain.Ethereum]: 100 })

    expect(getHighestBalanceChain(map, [makeEntry(UniverseChainId.Mainnet, '0xeth'), gnosisEntry])).toEqual(gnosisEntry)
  })

  it('returns undefined when multichainEntries is empty', () => {
    const map = buildMultiChainMap({ [GraphQLApi.Chain.Ethereum]: 100 })
    expect(getHighestBalanceChain(map, [])).toBeUndefined()
  })

  it('returns undefined when multiChainMap is empty', () => {
    expect(getHighestBalanceChain({}, entries)).toBeUndefined()
  })

  it('returns undefined when all balances are zero', () => {
    const map = buildMultiChainMap({
      [GraphQLApi.Chain.Ethereum]: 0,
      [GraphQLApi.Chain.Base]: 0,
    })
    expect(getHighestBalanceChain(map, entries)).toBeUndefined()
  })

  it('returns undefined when all balances are null', () => {
    const map = buildMultiChainMap({
      [GraphQLApi.Chain.Ethereum]: null,
      [GraphQLApi.Chain.Base]: null,
    })
    expect(getHighestBalanceChain(map, entries)).toBeUndefined()
  })

  it('returns undefined when no balance data exists', () => {
    const map: MultiChainMap = {
      [GraphQLApi.Chain.Ethereum]: { address: '0x1' },
      [GraphQLApi.Chain.Base]: { address: '0x2' },
    }
    expect(getHighestBalanceChain(map, entries)).toBeUndefined()
  })

  it('skips chains without a matching entry', () => {
    const limitedEntries = [makeEntry(UniverseChainId.Polygon, '0xpoly')]
    const map = buildMultiChainMap({
      [GraphQLApi.Chain.Ethereum]: 10_000,
      [GraphQLApi.Chain.Polygon]: 50,
    })
    expect(getHighestBalanceChain(map, limitedEntries)).toEqual(makeEntry(UniverseChainId.Polygon, '0xpoly'))
  })
})
