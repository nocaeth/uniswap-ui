/**
 * Data access for the analytics adapter — reads the SQLite store written by
 * `src/backfill.ts` (see db.ts). Replaces the old JSON snapshot. Exposes the
 * Explore read API (tokens/pools/protocol/rankings) consumed by
 * exploreService.ts + mappers.ts, plus the detail/transactions accessors used by
 * graphql.ts. Row shapes are typed below; the indexer is the single writer.
 */
import { getDb } from './db.js'

const DAY = 86400
const HOUR = 3600

// ---- Row types ----

export interface EnvioPriceHistory {
  start: number
  end: number
  step: number
  values: number[]
}

export interface EnvioToken {
  id: string
  symbol: string
  name: string
  decimals: number
  totalSupply: string
  logo: string
  priceUSD: number
  tvlUSD: number
  fdv: number
  volume1h: number
  volume1d: number
  volume7d: number
  volume30d: number
  volume1y: number
  priceChange1h: number
  priceChange1d: number
  priceChange1w: number
  priceChange1m: number
  priceChange1y: number
  /** Bucketed price series for Explore sparklines (built on demand). */
  priceHistory?: {
    hour: EnvioPriceHistory
    day: EnvioPriceHistory
    week: EnvioPriceHistory
    month: EnvioPriceHistory
    year: EnvioPriceHistory
  }
}

export interface EnvioPool {
  id: string
  token0: EnvioToken
  token1: EnvioToken
  feeTier: number
  tvlUSD: number
  tvlChange1d: number
  volume1d: number
  volume7d: number
  volume30d: number
  feesUSD: number
  txCount: number
  token0Price: number
  token1Price: number
  token0Supply: number
  token1Supply: number
  createdBlock: number
}

export interface EnvioTimestamped {
  timestamp: number
  value: number
}

export interface EnvioProtocolSeries {
  dailyTvl: EnvioTimestamped[]
  dailyVolume: EnvioTimestamped[]
}

export interface EnvioTransaction {
  id: string
  hash: string
  logIndex: number
  type: string // SWAP | ADD | REMOVE
  poolId: string
  token0: string
  token1: string
  amount0: number
  amount1: number
  amountUSD: number
  account: string
  timestamp: number
  blockNumber: number
}

interface TokenRow {
  id: string
  symbol: string
  name: string
  decimals: number
  totalSupply: string
  logo: string
  priceUSD: number
  tvlUSD: number
  fdv: number
  volume1h: number
  volume1d: number
  volume7d: number
  volume30d: number
  volume1y: number
  priceChange1h: number
  priceChange1d: number
  priceChange1w: number
  priceChange1m: number
  priceChange1y: number
}

interface PoolRow {
  id: string
  token0: string
  token1: string
  feeTier: number
  createdBlock: number
  tvlUSD: number
  tvlChange1d: number
  volume1d: number
  volume7d: number
  volume30d: number
  feesUSD: number
  txCount: number
  token0Price: number
  token1Price: number
  token0Supply: number
  token1Supply: number
}

function tokenFromRow(r: TokenRow): EnvioToken {
  return { ...r }
}

function buildHistory(points: { ts: number; price: number }[], step: number): EnvioPriceHistory {
  if (points.length === 0) {
    return { start: 0, end: 0, step, values: [] }
  }
  return {
    start: points[0].ts,
    end: points[points.length - 1].ts,
    step,
    values: points.map((p) => p.price),
  }
}

/** Loads every token snapshot row and attaches bucketed price-history series. */
export function fetchExploreStats(): { tokens: EnvioToken[]; pools: EnvioPool[] } {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const tokenRows = db.query<TokenRow>('SELECT * FROM tokens ORDER BY tvlUSD DESC').all()
  const tokenMap = new Map(tokenRows.map((r) => [r.id, r]))

  // Batch-load hourly (7d) + daily (365d) price points, grouped by token.
  const hourPts = new Map<string, { ts: number; price: number }[]>()
  for (const r of db
    .query<{ tokenId: string; hour: number; priceUSD: number }>(
      'SELECT tokenId,hour,priceUSD FROM token_hour_data WHERE hour >= ? ORDER BY hour ASC',
    )
    .all(now - 7 * DAY)) {
    let arr = hourPts.get(r.tokenId)
    if (!arr) {
      arr = []
      hourPts.set(r.tokenId, arr)
    }
    arr.push({ ts: r.hour, price: r.priceUSD })
  }
  const dayPts = new Map<string, { ts: number; price: number }[]>()
  for (const r of db
    .query<{ tokenId: string; day: number; priceUSD: number }>(
      'SELECT tokenId,day,priceUSD FROM token_day_data ORDER BY day ASC',
    )
    .all()) {
    let arr = dayPts.get(r.tokenId)
    if (!arr) {
      arr = []
      dayPts.set(r.tokenId, arr)
    }
    arr.push({ ts: r.day, price: r.priceUSD })
  }

  const within = (arr: { ts: number; price: number }[] | undefined, fromTs: number): { ts: number; price: number }[] =>
    (arr ?? []).filter((p) => p.ts >= fromTs)

  const tokens: EnvioToken[] = tokenRows.map((r) => {
    const h = hourPts.get(r.id)
    const d = dayPts.get(r.id)
    return {
      ...tokenFromRow(r),
      priceHistory: {
        hour: buildHistory(within(h, now - DAY), HOUR),
        day: buildHistory(within(h, now - DAY), HOUR),
        week: buildHistory(within(d, now - 7 * DAY), DAY),
        month: buildHistory(within(d, now - 30 * DAY), DAY),
        year: buildHistory(within(d, now - 365 * DAY), DAY),
      },
    }
  })

  const poolRows = db.query<PoolRow>('SELECT * FROM pools ORDER BY tvlUSD DESC').all()
  const pools: EnvioPool[] = poolRows.map((p) => poolFromRow(p, tokenMap))
  return { tokens, pools }
}

function poolFromRow(p: PoolRow, tokenMap: Map<string, TokenRow>): EnvioPool {
  const blank = (id: string): EnvioToken =>
    ({
      id,
      symbol: id.slice(0, 8),
      name: id.slice(0, 8),
      decimals: 18,
      totalSupply: '0',
      logo: '',
      priceUSD: 0,
      tvlUSD: 0,
      fdv: 0,
      volume1h: 0,
      volume1d: 0,
      volume7d: 0,
      volume30d: 0,
      volume1y: 0,
      priceChange1h: 0,
      priceChange1d: 0,
      priceChange1w: 0,
      priceChange1m: 0,
      priceChange1y: 0,
    }) satisfies EnvioToken
  const t0 = tokenMap.get(p.token0)
  const t1 = tokenMap.get(p.token1)
  return {
    id: p.id,
    token0: t0 ? tokenFromRow(t0) : blank(p.token0),
    token1: t1 ? tokenFromRow(t1) : blank(p.token1),
    feeTier: p.feeTier,
    tvlUSD: p.tvlUSD,
    tvlChange1d: p.tvlChange1d,
    volume1d: p.volume1d,
    volume7d: p.volume7d,
    volume30d: p.volume30d,
    feesUSD: p.feesUSD,
    txCount: p.txCount,
    token0Price: p.token0Price,
    token1Price: p.token1Price,
    token0Supply: p.token0Supply,
    token1Supply: p.token1Supply,
    createdBlock: p.createdBlock,
  }
}

export function fetchTopTokens(limit = 100): { Token: EnvioToken[] } {
  return { Token: fetchExploreStats().tokens.slice(0, limit) }
}

export function fetchTopPools(limit = 100): { Pool: EnvioPool[] } {
  return { Pool: fetchExploreStats().pools.slice(0, limit) }
}

export function fetchProtocolStats(): EnvioProtocolSeries {
  const db = getDb()
  const rows = db
    .query<{ day: number; tvlUSD: number; volumeUSD: number }>('SELECT day,tvlUSD,volumeUSD FROM protocol_day_data ORDER BY day ASC')
    .all()
  return {
    dailyTvl: rows.map((r) => ({ timestamp: r.day, value: r.tvlUSD })),
    dailyVolume: rows.map((r) => ({ timestamp: r.day, value: r.volumeUSD })),
  }
}

// ---- GraphQL detail accessors ----

export function getTokenRow(address: string): EnvioToken | undefined {
  const db = getDb()
  const r = db.query<TokenRow>('SELECT * FROM tokens WHERE id = ?').get(address.toLowerCase())
  return r ? tokenFromRow(r) : undefined
}

export function getPoolRow(address: string): EnvioPool | undefined {
  const db = getDb()
  const p = db.query<PoolRow>('SELECT * FROM pools WHERE id = ?').get(address.toLowerCase())
  if (!p) {
    return undefined
  }
  const tokenMap = new Map<string, TokenRow>()
  for (const id of [p.token0, p.token1]) {
    const t = db.query<TokenRow>('SELECT * FROM tokens WHERE id = ?').get(id)
    if (t) {
      tokenMap.set(id, t)
    }
  }
  return poolFromRow(p, tokenMap)
}

/** Find the V3 pool whose price chart best represents a token (deepest pool it is in). */
export function getDeepestPoolForToken(address: string): EnvioPool | undefined {
  const db = getDb()
  const a = address.toLowerCase()
  const p = db
    .query<PoolRow>('SELECT * FROM pools WHERE token0 = ? OR token1 = ? ORDER BY tvlUSD DESC LIMIT 1')
    .get(a, a)
  if (!p) {
    return undefined
  }
  return getPoolRow(p.id)
}

export function getTokenPriceHistory(address: string, fromTs: number, hourly: boolean): EnvioTimestamped[] {
  const db = getDb()
  const a = address.toLowerCase()
  if (hourly) {
    return db
      .query<{ hour: number; priceUSD: number }>('SELECT hour,priceUSD FROM token_hour_data WHERE tokenId = ? AND hour >= ? ORDER BY hour ASC')
      .all(a, fromTs)
      .map((r) => ({ timestamp: r.hour, value: r.priceUSD }))
  }
  return db
    .query<{ day: number; priceUSD: number }>('SELECT day,priceUSD FROM token_day_data WHERE tokenId = ? AND day >= ? ORDER BY day ASC')
    .all(a, fromTs)
    .map((r) => ({ timestamp: r.day, value: r.priceUSD }))
}

export function getTokenVolumeHistory(address: string, fromTs: number, hourly: boolean): EnvioTimestamped[] {
  const db = getDb()
  const a = address.toLowerCase()
  if (hourly) {
    return db
      .query<{ hour: number; volumeUSD: number }>('SELECT hour,volumeUSD FROM token_hour_data WHERE tokenId = ? AND hour >= ? ORDER BY hour ASC')
      .all(a, fromTs)
      .map((r) => ({ timestamp: r.hour, value: r.volumeUSD }))
  }
  return db
    .query<{ day: number; volumeUSD: number }>('SELECT day,volumeUSD FROM token_day_data WHERE tokenId = ? AND day >= ? ORDER BY day ASC')
    .all(a, fromTs)
    .map((r) => ({ timestamp: r.day, value: r.volumeUSD }))
}

export function getTokenTvlHistory(address: string, fromTs: number): EnvioTimestamped[] {
  const db = getDb()
  return db
    .query<{ day: number; tvlUSD: number }>('SELECT day,tvlUSD FROM token_day_data WHERE tokenId = ? AND day >= ? ORDER BY day ASC')
    .all(address.toLowerCase(), fromTs)
    .map((r) => ({ timestamp: r.day, value: r.tvlUSD }))
}

export interface EnvioPoolPrice {
  timestamp: number
  token0Price: number
  token1Price: number
}

export function getPoolPriceHistory(address: string, fromTs: number, hourly: boolean): EnvioPoolPrice[] {
  const db = getDb()
  const a = address.toLowerCase()
  if (hourly) {
    return db
      .query<{ hour: number; token0Price: number; token1Price: number }>(
        'SELECT hour,token0Price,token1Price FROM pool_hour_data WHERE poolId = ? AND hour >= ? ORDER BY hour ASC',
      )
      .all(a, fromTs)
      .map((r) => ({ timestamp: r.hour, token0Price: r.token0Price, token1Price: r.token1Price }))
  }
  return db
    .query<{ day: number; token0Price: number; token1Price: number }>(
      'SELECT day,token0Price,token1Price FROM pool_day_data WHERE poolId = ? AND day >= ? ORDER BY day ASC',
    )
    .all(a, fromTs)
    .map((r) => ({ timestamp: r.day, token0Price: r.token0Price, token1Price: r.token1Price }))
}

export function getPoolVolumeHistory(address: string, fromTs: number, hourly: boolean): EnvioTimestamped[] {
  const db = getDb()
  const a = address.toLowerCase()
  if (hourly) {
    return db
      .query<{ hour: number; volumeUSD: number }>('SELECT hour,volumeUSD FROM pool_hour_data WHERE poolId = ? AND hour >= ? ORDER BY hour ASC')
      .all(a, fromTs)
      .map((r) => ({ timestamp: r.hour, value: r.volumeUSD }))
  }
  return db
    .query<{ day: number; volumeUSD: number }>('SELECT day,volumeUSD FROM pool_day_data WHERE poolId = ? AND day >= ? ORDER BY day ASC')
    .all(a, fromTs)
    .map((r) => ({ timestamp: r.day, value: r.volumeUSD }))
}

export function getPoolCumulativeVolume(address: string, fromTs: number): number {
  const db = getDb()
  const r = db
    .query<{ v: number }>('SELECT COALESCE(SUM(volumeUSD),0) AS v FROM pool_day_data WHERE poolId = ? AND day >= ?')
    .get(address.toLowerCase(), fromTs)
  return r?.v ?? 0
}

export function getPoolTransactions(poolId: string, first: number, beforeTs?: number): EnvioTransaction[] {
  const db = getDb()
  const cursor = beforeTs ?? 1e12
  return db
    .query<EnvioTransaction>('SELECT * FROM transactions WHERE poolId = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?')
    .all(poolId.toLowerCase(), cursor, first)
}

export function getTokenTransactions(address: string, first: number, beforeTs?: number): EnvioTransaction[] {
  const db = getDb()
  const a = address.toLowerCase()
  const cursor = beforeTs ?? 1e12
  return db
    .query<EnvioTransaction>(
      'SELECT * FROM transactions WHERE (token0 = ? OR token1 = ?) AND timestamp < ? ORDER BY timestamp DESC LIMIT ?',
    )
    .all(a, a, cursor, first)
}

export function getRecentTransactions(first: number, beforeTs?: number): EnvioTransaction[] {
  const db = getDb()
  const cursor = beforeTs ?? 1e12
  return db
    .query<EnvioTransaction>('SELECT * FROM transactions WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?')
    .all(cursor, first)
}

export function getMeta(key: string): string | undefined {
  try {
    const db = getDb()
    return db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?').get(key)?.value
  } catch {
    return undefined
  }
}
