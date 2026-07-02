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
  fetchGnosisTopV3Pools,
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
    const third = await fetchGnosisPoolTvlUSDByAddress([POOL_B])

    expect(first.get(POOL_A)).toBe(2_500)
    expect(second.get(POOL_A)).toBe(2_500)
    expect(second.has(POOL_B)).toBe(false)
    expect(third.has(POOL_B)).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('negative-caches pools when the adapter returns a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response)

    const first = await fetchGnosisPoolTvlUSDByAddress([POOL_A])
    const second = await fetchGnosisPoolTvlUSDByAddress([POOL_A])

    expect(first.has(POOL_A)).toBe(false)
    expect(second.has(POOL_A)).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('Gnosis top pools', () => {
  beforeEach(() => {
    clearGnosisPoolTvlCache()
    mockFetch.mockReset()
  })

  function topPool(address: string, tvlUSD: number): Record<string, unknown> {
    return {
      address,
      feeTier: 500,
      totalLiquidity: { value: tvlUSD },
      token0: { address: TOKEN_A, symbol: 'T0', decimals: 18 },
      token1: { address: TOKEN_B, symbol: 'T1', decimals: 6 },
    }
  }

  it('fetches the full pool set once, caches it, and skips malformed entries', async () => {
    mockFetch.mockResolvedValueOnce(
      graphQlResponse({
        data: {
          topV3Pools: [topPool(POOL_A, 50_000), { address: POOL_B, feeTier: 3000 /* no tokens */ }, null],
        },
      }),
    )

    const pools = await fetchGnosisTopV3Pools()
    const again = await fetchGnosisTopV3Pools()

    expect(pools).toEqual([
      {
        address: POOL_A,
        fee: 500,
        tvlUSD: 50_000,
        token0: { address: TOKEN_A, symbol: 'T0', decimals: 18 },
        token1: { address: TOKEN_B, symbol: 'T1', decimals: 6 },
      },
    ])
    expect(again).toEqual(pools)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://analytics.example/v1/graphql',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('topV3Pools') }),
    )
  })

  it('seeds the per-pool TVL cache so annotation needs no second fetch', async () => {
    mockFetch.mockResolvedValueOnce(graphQlResponse({ data: { topV3Pools: [topPool(POOL_A, 50_000)] } }))

    await fetchGnosisTopV3Pools()
    const edges = await annotateGnosisPoolGraphEdgesWithTvl([
      { tokenA: TOKEN_A, tokenB: TOKEN_B, fee: 500, liquidity: '100', initialized: true, poolAddress: POOL_A },
    ])

    expect(edges[0]).toEqual(expect.objectContaining({ poolAddress: POOL_A, tvlUSD: 50_000 }))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns undefined and negative-caches when the fetch fails or the store is empty', async () => {
    mockFetch.mockRejectedValueOnce(new Error('adapter unavailable'))
    expect(await fetchGnosisTopV3Pools()).toBeUndefined()
    expect(await fetchGnosisTopV3Pools()).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    clearGnosisPoolTvlCache()
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(graphQlResponse({ data: { topV3Pools: [] } }))
    expect(await fetchGnosisTopV3Pools()).toBeUndefined()
  })
})
