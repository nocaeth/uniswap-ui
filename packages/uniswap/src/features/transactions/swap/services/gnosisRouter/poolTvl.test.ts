vi.mock('uniswap/src/config', () => ({
  config: {
    graphqlUrlOverride: 'https://analytics.example/v1/graphql',
  },
}))

vi.mock('uniswap/src/constants/urls', () => ({
  getUniswapServiceUrls: (): { graphQLUrl: string } => ({
    graphQLUrl: 'https://analytics.example/v1/graphql',
  }),
}))

import {
  annotateGnosisPoolGraphEdgesWithTvl,
  clearGnosisPoolTvlCache,
  fetchGnosisPoolTvlUSDByAddress,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolTvl'
import type { GnosisPoolGraphEdge } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'

const POOL_A = '0x1111111111111111111111111111111111111111'
const POOL_B = '0x2222222222222222222222222222222222222222'
const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

function graphQlResponse(data: unknown): Response {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response
}

function poolEdge(poolAddress: string): GnosisPoolGraphEdge {
  return {
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    fee: 500,
    liquidity: '100',
    initialized: true,
    poolAddress,
  }
}

describe('Gnosis pool TVL', () => {
  beforeEach(() => {
    clearGnosisPoolTvlCache()
    mockFetch.mockReset()
  })

  it('fetches pool TVL from the Gnosis GraphQL adapter and caches it', async () => {
    mockFetch.mockResolvedValueOnce(
      graphQlResponse({
        data: {
          pool0: {
            address: POOL_A,
            totalLiquidity: { value: 1_234 },
          },
        },
      }),
    )

    const first = await fetchGnosisPoolTvlUSDByAddress([POOL_A, POOL_A])
    const second = await fetchGnosisPoolTvlUSDByAddress([POOL_A])

    expect(first.get(POOL_A)).toBe(1_234)
    expect(second.get(POOL_A)).toBe(1_234)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://analytics.example/v1/graphql',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('v3Pool'),
      }),
    )
  })

  it('annotates discovered pool edges with known TVL and leaves missing pools unchanged', async () => {
    mockFetch.mockResolvedValueOnce(
      graphQlResponse({
        data: {
          pool0: {
            address: POOL_A,
            totalLiquidity: { value: 2_500 },
          },
          pool1: null,
        },
      }),
    )

    const edges = await annotateGnosisPoolGraphEdgesWithTvl([poolEdge(POOL_A), poolEdge(POOL_B)])

    expect(edges[0]).toEqual(expect.objectContaining({ poolAddress: POOL_A, tvlUSD: 2_500 }))
    expect(edges[1]).toEqual(expect.objectContaining({ poolAddress: POOL_B }))
    expect(edges[1]).not.toHaveProperty('tvlUSD')
  })

  it('returns cached values when a later adapter request fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        graphQlResponse({
          data: {
            pool0: {
              address: POOL_A,
              totalLiquidity: { value: 2_500 },
            },
          },
        }),
      )
      .mockRejectedValueOnce(new Error('adapter unavailable'))

    const first = await fetchGnosisPoolTvlUSDByAddress([POOL_A])
    const second = await fetchGnosisPoolTvlUSDByAddress([POOL_A, POOL_B])

    expect(first.get(POOL_A)).toBe(2_500)
    expect(second.get(POOL_A)).toBe(2_500)
    expect(second.has(POOL_B)).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
