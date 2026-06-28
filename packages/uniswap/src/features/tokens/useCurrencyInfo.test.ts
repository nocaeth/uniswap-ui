import { renderHook } from '@testing-library/react'
import { GraphQLApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getGnosisTokenListLogoURI } from 'uniswap/src/features/tokens/gnosisTokenList'
import { useCurrencyInfos, useCurrencyInfosWithLoading } from 'uniswap/src/features/tokens/useCurrencyInfo'

vi.mock('@universe/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@universe/api')>()

  return {
    ...actual,
    GraphQLApi: {
      ...actual.GraphQLApi,
      useTokenQuery: vi.fn(),
      useTokensQuery: vi.fn(),
    },
  }
})

type TokensQueryToken = NonNullable<NonNullable<GraphQLApi.TokensQuery['tokens']>[number]>

const TOKEN_A_ADDRESS = '0x1111111111111111111111111111111111111111'
const TOKEN_B_ADDRESS = '0x2222222222222222222222222222222222222222'
const TOKEN_A_CURRENCY_ID = `${UniverseChainId.Mainnet}-${TOKEN_A_ADDRESS}`
const TOKEN_B_CURRENCY_ID = `${UniverseChainId.Mainnet}-${TOKEN_B_ADDRESS}`
const GNOSIS_WSTETH_ADDRESS = '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6'
const GNOSIS_WSTETH_CURRENCY_ID = `${UniverseChainId.Gnosis}-${GNOSIS_WSTETH_ADDRESS}`

const mockUseTokensQuery = vi.mocked(GraphQLApi.useTokensQuery)

function makeGqlToken({ address, symbol }: { address: string; symbol: string }): TokensQueryToken {
  return {
    __typename: 'Token',
    id: `${GraphQLApi.Chain.Ethereum}-${address}`,
    address,
    chain: GraphQLApi.Chain.Ethereum,
    decimals: 18,
    name: symbol,
    symbol,
  }
}

function mockTokensQuery({
  tokens,
  loading = false,
}: {
  tokens: GraphQLApi.TokensQuery['tokens']
  loading?: boolean
}): void {
  mockUseTokensQuery.mockReturnValue({
    data: { tokens },
    loading,
    error: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof GraphQLApi.useTokensQuery>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTokensQuery({ tokens: [] })
})

describe(useCurrencyInfos, () => {
  it('aligns reordered GraphQL tokens by returned chain and address', () => {
    mockTokensQuery({
      tokens: [
        makeGqlToken({ address: TOKEN_B_ADDRESS, symbol: 'BBB' }),
        makeGqlToken({ address: TOKEN_A_ADDRESS, symbol: 'AAA' }),
      ],
    })

    const { result } = renderHook(() => useCurrencyInfos([TOKEN_A_CURRENCY_ID, TOKEN_B_CURRENCY_ID]))

    expect(result.current.map((currencyInfo) => currencyInfo?.currency.symbol)).toEqual(['AAA', 'BBB'])
  })

  it('leaves an unresolved requested currencyId empty when GraphQL omits it', () => {
    mockTokensQuery({
      tokens: [makeGqlToken({ address: TOKEN_B_ADDRESS, symbol: 'BBB' })],
    })

    const { result } = renderHook(() => useCurrencyInfos([TOKEN_A_CURRENCY_ID, TOKEN_B_CURRENCY_ID]))

    expect(result.current[0]).toBeUndefined()
    expect(result.current[1]?.currency.symbol).toBe('BBB')
  })

  it('preserves local Gnosis common-base fallback when GraphQL returns no token', () => {
    mockTokensQuery({ tokens: [] })

    const { result } = renderHook(() => useCurrencyInfos([GNOSIS_WSTETH_CURRENCY_ID]))

    expect(result.current[0]?.currencyId).toBe(GNOSIS_WSTETH_CURRENCY_ID)
    expect(result.current[0]?.logoUrl).toBe(
      getGnosisTokenListLogoURI({ chainId: UniverseChainId.Gnosis, address: GNOSIS_WSTETH_ADDRESS }),
    )
  })
})

describe(useCurrencyInfosWithLoading, () => {
  it('returns filtered currency infos in requested order when GraphQL reorders tokens', () => {
    mockTokensQuery({
      tokens: [
        makeGqlToken({ address: TOKEN_B_ADDRESS, symbol: 'BBB' }),
        makeGqlToken({ address: TOKEN_A_ADDRESS, symbol: 'AAA' }),
      ],
    })

    const { result } = renderHook(() => useCurrencyInfosWithLoading([TOKEN_A_CURRENCY_ID, TOKEN_B_CURRENCY_ID]))

    expect(result.current.data?.map((currencyInfo) => currencyInfo.currency.symbol)).toEqual(['AAA', 'BBB'])
  })
})
