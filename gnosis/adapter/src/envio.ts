/**
 * Data access for the analytics adapter.
 *
 * Reads the snapshot produced by `src/backfill.ts` (HyperSync events + RPC state)
 * from `data/analytics.json`. This replaces the original Hasura/Envio-GraphQL
 * source: envio's codegen is a no-op on this platform, so the indexer never runs.
 * The snapshot is re-read from disk on each request (it is small) and is refreshed
 * out-of-band by re-running `bun run backfill`. The exported function/return shapes
 * are unchanged so exploreService/graphql/mappers need no edits.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SNAPSHOT_PATH = process.env.ANALYTICS_SNAPSHOT_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'analytics.json')

// ---- Row types (shape of the backfill snapshot) ----

export interface EnvioToken {
  id: string
  symbol: string
  name: string
  decimals: number
  totalValueLockedUSD: number
  volumeUSD: number
  txCount: number
  derivedXDAI: number
}

export interface EnvioPool {
  id: string
  feeTier: number
  totalValueLockedUSD: number
  volumeUSD: number
  txCount: number
  token0: EnvioToken
  token1: EnvioToken
}

export interface EnvioTokenDayData {
  date: number
  priceUSD: number
  volumeUSD: number
}

export interface EnvioProtocolStats {
  totalValueLockedUSD: number
  volumeUSD: number
  txCount: number
  poolCount: number
}

interface Snapshot {
  updatedAtBlock: number
  tokens: EnvioToken[]
  pools: EnvioPool[]
  protocol: EnvioProtocolStats & { id: string }
}

function readSnapshot(): Snapshot {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot
  } catch {
    throw new Error(
      `analytics snapshot not found at ${SNAPSHOT_PATH}. Run \`bun run backfill\` in gnosis/adapter first.`,
    )
  }
}

/** Top tokens for the Explore tokens table (snapshot is already sorted by TVL). */
export function fetchTopTokens(limit = 100): Promise<{ Token: EnvioToken[] }> {
  return Promise.resolve({ Token: readSnapshot().tokens.slice(0, limit) })
}

/** Top pools for the Explore pools table (snapshot is already sorted by TVL). */
export function fetchTopPools(limit = 100): Promise<{ Pool: EnvioPool[] }> {
  return Promise.resolve({ Pool: readSnapshot().pools.slice(0, limit) })
}

/**
 * Daily price/volume points for a token's charts. The backfill does not yet emit
 * historical day-data (only current TVL + 24h volume), so this returns empty until
 * a day-data rollup is added. Detail-page charts therefore render empty for now.
 */
export function fetchTokenDayData(_tokenId: string, _days = 365): Promise<{ TokenDayData: EnvioTokenDayData[] }> {
  return Promise.resolve({ TokenDayData: [] })
}

export function fetchProtocolStats(): Promise<{ ProtocolStats: EnvioProtocolStats[] }> {
  return Promise.resolve({ ProtocolStats: [readSnapshot().protocol] })
}
