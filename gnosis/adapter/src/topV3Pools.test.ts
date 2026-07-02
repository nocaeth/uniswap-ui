/**
 * topV3Pools GraphQL query: full TVL-ordered pool set for the router's pool graph.
 *
 * Runs under `bun test` against a throwaway SQLite store: ANALYTICS_DB_PATH must
 * be set before db.ts is imported (its DB_PATH is read at module load), hence the
 * env assignment + dynamic imports at the top.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpDir = mkdtempSync(join(tmpdir(), 'gnosis-adapter-topv3pools-'))
process.env.ANALYTICS_DB_PATH = join(tmpDir, 'analytics.db')

const { getDb, initSchema } = await import('./db.js')
const { schema } = await import('./graphql.js')
const { graphql } = await import('graphql')

const db = getDb(true)
initSchema(db)

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const QUERY = `
  query TopV3Pools($first: Int!, $cursor: Float, $tokenAddress: String) {
    topV3Pools(chain: ETHEREUM, first: $first, tvlCursor: $cursor, tokenFilter: $tokenAddress) {
      address
      feeTier
      totalLiquidity { value }
      token0 { address symbol decimals }
      token1 { address symbol decimals }
    }
  }
`

interface PoolResult {
  address: string
  feeTier: number
  totalLiquidity: { value: number }
  token0: { address: string; symbol: string; decimals: number }
  token1: { address: string; symbol: string; decimals: number }
}

async function queryTopPools(variables: {
  first: number
  cursor?: number
  tokenAddress?: string
}): Promise<PoolResult[]> {
  const result = await graphql({ schema, source: QUERY, variableValues: variables })
  expect(result.errors).toBeUndefined()
  return (result.data as { topV3Pools: PoolResult[] }).topV3Pools
}

const WXDAI = '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d'
const USDCE = '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0'
const EURE = '0xcb444e90d8198415266c6a2724b7900fb12fc56e'
const SDAI = '0xaf204776c7245bf4147c2612bf6e5972ee483701'
const UNKNOWN = '0x1111111111111111111111111111111111111111'

function seedToken(id: string, symbol: string, decimals: number): void {
  db.run(
    `INSERT INTO tokens (id, symbol, name, decimals, totalSupply, logo, priceUSD, tvlUSD, fdv,
       volume1h, volume1d, volume7d, volume30d, volume1y,
       priceChange1h, priceChange1d, priceChange1w, priceChange1m, priceChange1y)
     VALUES (?, ?, ?, ?, '0', '', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
    id,
    symbol,
    symbol,
    decimals,
  )
}

function seedPool(id: string, token0: string, token1: string, feeTier: number, tvlUSD: number): void {
  db.run(
    `INSERT INTO pools (id, token0, token1, feeTier, createdBlock, createdTimestamp, tvlUSD, tvlChange1d,
       volume1d, volume7d, volume30d, feesUSD, txCount, token0Price, token1Price, token0Supply, token1Supply)
     VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0)`,
    id,
    token0,
    token1,
    feeTier,
    tvlUSD,
  )
}

describe('topV3Pools', () => {
  test('empty store returns no pools', async () => {
    const pools = await queryTopPools({ first: 10 })
    expect(pools).toEqual([])
  })

  test('returns all pools TVL-ordered with token metadata', async () => {
    seedToken(WXDAI, 'WXDAI', 18)
    seedToken(USDCE, 'USDC.e', 6)
    seedToken(EURE, 'EURe', 18)
    seedToken(SDAI, 'sDAI', 18)
    seedPool('0xpoolwxdaiusdce', WXDAI, USDCE, 100, 36_000)
    seedPool('0xpooleuresdai', SDAI, EURE, 500, 500_000)
    seedPool('0xpooleureusdce', USDCE, EURE, 500, 120_000)
    seedPool('0xpoolunknown', UNKNOWN, USDCE, 3000, 50)

    const pools = await queryTopPools({ first: 10 })
    expect(pools.map((p) => p.address)).toEqual([
      '0xpooleuresdai',
      '0xpooleureusdce',
      '0xpoolwxdaiusdce',
      '0xpoolunknown',
    ])

    const top = pools[0]
    expect(top?.feeTier).toBe(500)
    expect(top?.totalLiquidity.value).toBe(500_000)
    expect(top?.token0).toEqual({ address: SDAI, symbol: 'sDAI', decimals: 18 })
    expect(top?.token1).toEqual({ address: EURE, symbol: 'EURe', decimals: 18 })
  })

  test('first limits the result set from the top', async () => {
    const pools = await queryTopPools({ first: 2 })
    expect(pools.map((p) => p.address)).toEqual(['0xpooleuresdai', '0xpooleureusdce'])
  })

  test('tvlCursor pages strictly below the cursor', async () => {
    const pools = await queryTopPools({ first: 10, cursor: 120_000 })
    expect(pools.map((p) => p.address)).toEqual(['0xpoolwxdaiusdce', '0xpoolunknown'])
  })

  test('tokenFilter matches either side, case-insensitively', async () => {
    const pools = await queryTopPools({ first: 10, tokenAddress: WXDAI.toUpperCase().replace('0X', '0x') })
    expect(pools.map((p) => p.address)).toEqual(['0xpoolwxdaiusdce'])
  })

  test('pool with a token missing from the tokens table falls back to blank metadata', async () => {
    const pools = await queryTopPools({ first: 10 })
    const unknownPool = pools.find((p) => p.address === '0xpoolunknown')
    expect(unknownPool?.token0.symbol).toBe(UNKNOWN.slice(0, 8))
    expect(unknownPool?.token0.decimals).toBe(18)
  })
})
