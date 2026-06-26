/**
 * GraphQL endpoint for token/pool detail pages + transactions.
 *
 * The web client (Apollo) sends operations defined against Uniswap's full schema
 * (packages/api/src/clients/graphql/web/*.graphql): TokenWeb, TokenProjectWeb,
 * TokenSpotPrice, TokenPrice/TokenHistorical*, V3Pool, PoolPriceHistory/Volume,
 * pool + token transactions. We load that exact schema SDL (so every operation
 * validates) and resolve the slice Gnosis V3 can answer from the SQLite store
 * (envio.ts). v4/v2 resolvers return null/empty — Gnosis is V3-only.
 *
 * The app sends `chain: ETHEREUM` for Gnosis (its backendChain is pinned to
 * Ethereum) but maps the response `chain` back via fromGraphQLChain('GNOSIS').
 * The upstream Chain enum has no GNOSIS, so we inject it into the loaded SDL and
 * return 'GNOSIS' on every chain field.
 *
 * Point the app here with GRAPHQL_URL_OVERRIDE=<base>/v1/graphql.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSchema } from 'graphql-yoga'
import {
  getDeepestPoolForToken,
  getPoolCumulativeVolume,
  getPoolPriceHistory,
  getPoolRow,
  getPoolTransactions,
  getPoolVolumeHistory,
  getRecentTransactions,
  getTokenPriceHistory,
  getTokenRow,
  getTokenTransactions,
  getTokenTvlHistory,
  getTokenVolumeHistory,
  type EnvioPool,
  type EnvioToken,
  type EnvioTransaction,
} from './envio.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH =
  process.env.GRAPHQL_SCHEMA_PATH ??
  join(HERE, '..', '..', '..', 'packages', 'api', 'src', 'clients', 'graphql', 'schema.graphql')

// Load the real upstream schema and add GNOSIS to the Chain enum so resolver
// return values serialize (the upstream enum omits it).
const rawSdl = readFileSync(SCHEMA_PATH, 'utf8')
const sdl = rawSdl.replace(/enum Chain \{/, 'enum Chain {\n  GNOSIS')

const CHAIN = 'GNOSIS'
const now = (): number => Math.floor(Date.now() / 1000)

interface Amt {
  id: string
  value: number
  currency: string
}
const amt = (id: string, value: number, currency = 'USD'): Amt => ({ id, value, currency })

interface DurationWindow {
  fromTs: number
  hourly: boolean
}
function durationWindow(duration: string): DurationWindow {
  const n = now()
  switch (duration) {
    case 'FIVE_MINUTE':
    case 'HOUR':
      return { fromTs: n - 3600, hourly: true }
    case 'DAY':
      return { fromTs: n - 86400, hourly: true }
    case 'WEEK':
      return { fromTs: n - 7 * 86400, hourly: true }
    case 'MONTH':
      return { fromTs: n - 30 * 86400, hourly: false }
    case 'YEAR':
      return { fromTs: n - 365 * 86400, hourly: false }
    case 'MAX':
      return { fromTs: 0, hourly: false }
    default:
      return { fromTs: n - 86400, hourly: true }
  }
}

function volumeForDuration(t: EnvioToken, duration: string): number {
  switch (duration) {
    case 'FIVE_MINUTE':
    case 'HOUR':
      return t.volume1h
    case 'DAY':
      return t.volume1d
    case 'WEEK':
      return t.volume7d
    case 'MONTH':
      return t.volume30d
    case 'YEAR':
    case 'MAX':
      return t.volume1y
    default:
      return t.volume1d
  }
}

// ---- source builders (carry the SQLite row down the resolver tree) ----

function tokenScalars(row: EnvioToken): Record<string, unknown> {
  return {
    id: row.id,
    address: row.id,
    chain: CHAIN,
    decimals: row.decimals,
    name: row.name,
    symbol: row.symbol,
    standard: 'ERC20',
    isBridged: false,
    bridgedWithdrawalInfo: null,
    feeData: { buyFeeBps: null, sellFeeBps: null, feeTakenOnTransfer: false, externalTransferFailed: false, sellReverted: false },
    protectionInfo: { result: 'BENIGN', attackTypes: [], blockaidFees: null },
  }
}

interface TokenSource extends Record<string, unknown> {
  __row: EnvioToken
}
function tokenSource(row: EnvioToken): TokenSource {
  return { ...tokenScalars(row), __row: row }
}
function blankToken(addr: string): EnvioToken {
  return {
    id: addr,
    symbol: addr.slice(0, 8),
    name: addr.slice(0, 8),
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
  }
}
function tokenSourceByAddr(addr: string): TokenSource {
  return tokenSource(getTokenRow(addr) ?? blankToken(addr))
}

interface PoolSource extends Record<string, unknown> {
  __pool: EnvioPool
}
function poolSource(p: EnvioPool): PoolSource {
  return {
    id: p.id,
    address: p.id,
    protocolVersion: 'V3',
    chain: CHAIN,
    feeTier: p.feeTier,
    txCount: p.txCount,
    token0Supply: p.token0Supply,
    token1Supply: p.token1Supply,
    __pool: p,
  }
}

export const schema = createSchema({
  typeDefs: sdl,
  resolvers: {
    Query: {
      token: (_: unknown, args: { address?: string | null }) => {
        if (!args.address) {
          return null
        }
        const row = getTokenRow(args.address)
        return row ? tokenSource(row) : null
      },
      tokens: (_: unknown, args: { contracts: { address?: string | null }[] }) =>
        (args.contracts ?? []).map((c) => (c.address ? tokenSource(getTokenRow(c.address) ?? blankToken(c.address)) : null)),
      tokenProjects: (_: unknown, args: { contracts: { address?: string | null }[] }) =>
        (args.contracts ?? []).map((c) => {
          if (!c.address) {
            return null
          }
          const row = getTokenRow(c.address)
          return row ? { __row: row } : null
        }),
      v3Pool: (_: unknown, args: { address: string }) => {
        const p = getPoolRow(args.address)
        return p ? poolSource(p) : null
      },
      v4Pool: () => null,
      v2Pair: () => null,
      v3Transactions: (_: unknown, args: { first: number; timestampCursor?: number | null }) =>
        getRecentTransactions(args.first ?? 100, args.timestampCursor ?? undefined),
      v4Transactions: () => [],
      v2Transactions: () => [],
    },

    Token: {
      market: (parent: TokenSource) => parent.__row,
      project: (parent: TokenSource) => ({ __row: parent.__row }),
      v3Transactions: (parent: TokenSource, args: { first: number; timestampCursor?: number | null }) =>
        getTokenTransactions(parent.__row.id, args.first ?? 100, args.timestampCursor ?? undefined),
      v4Transactions: () => [],
      v2Transactions: () => [],
    },

    TokenMarket: {
      id: (m: EnvioToken) => `${m.id}-market`,
      price: (m: EnvioToken) => amt(`${m.id}-price`, m.priceUSD),
      totalValueLocked: (m: EnvioToken) => amt(`${m.id}-tvl`, m.tvlUSD),
      volume: (m: EnvioToken, args: { duration?: string }) =>
        amt(`${m.id}-vol-${args.duration ?? 'DAY'}`, volumeForDuration(m, args.duration ?? 'DAY')),
      pricePercentChange: (m: EnvioToken) => amt(`${m.id}-ppc`, m.priceChange1d, ''),
      priceHighLow: (m: EnvioToken, args: { duration: string; highLow: string }) => {
        const w = durationWindow(args.duration)
        const pts = getTokenPriceHistory(m.id, w.fromTs, w.hourly).map((p) => p.value)
        const v = pts.length ? (args.highLow === 'LOW' ? Math.min(...pts) : Math.max(...pts)) : m.priceUSD
        return amt(`${m.id}-${args.highLow}-${args.duration}`, v)
      },
      priceHistory: (m: EnvioToken, args: { duration: string }) => {
        const w = durationWindow(args.duration)
        return getTokenPriceHistory(m.id, w.fromTs, w.hourly).map((p) => ({
          id: `${m.id}-ph-${p.timestamp}`,
          timestamp: p.timestamp,
          value: p.value,
          currency: 'USD',
        }))
      },
      ohlc: (m: EnvioToken, args: { duration: string }) => {
        const w = durationWindow(args.duration)
        return getTokenPriceHistory(m.id, w.fromTs, w.hourly).map((p) => ({
          id: `${m.id}-ohlc-${p.timestamp}`,
          timestamp: p.timestamp,
          open: amt(`${m.id}-o-${p.timestamp}`, p.value),
          high: amt(`${m.id}-h-${p.timestamp}`, p.value),
          low: amt(`${m.id}-l-${p.timestamp}`, p.value),
          close: amt(`${m.id}-c-${p.timestamp}`, p.value),
        }))
      },
      historicalVolume: (m: EnvioToken, args: { duration: string }) => {
        const w = durationWindow(args.duration)
        return getTokenVolumeHistory(m.id, w.fromTs, w.hourly).map((p) => ({
          id: `${m.id}-hv-${p.timestamp}`,
          timestamp: p.timestamp,
          value: p.value,
          currency: 'USD',
        }))
      },
      historicalTvl: (m: EnvioToken, args: { duration: string }) => {
        const w = durationWindow(args.duration)
        return getTokenTvlHistory(m.id, w.fromTs).map((p) => ({
          id: `${m.id}-ht-${p.timestamp}`,
          timestamp: p.timestamp,
          value: p.value,
          currency: 'USD',
        }))
      },
      priceSource: () => 'SUBGRAPH_V3',
    },

    TokenProject: {
      id: (p: { __row: EnvioToken }) => `${p.__row.id}-project`,
      name: (p: { __row: EnvioToken }) => p.__row.name,
      description: () => null,
      homepageUrl: () => null,
      twitterName: () => null,
      logoUrl: (p: { __row: EnvioToken }) => p.__row.logo || null,
      isSpam: () => false,
      safetyLevel: () => 'VERIFIED',
      logo: (p: { __row: EnvioToken }) => (p.__row.logo ? { id: `${p.__row.id}-logo`, url: p.__row.logo } : null),
      markets: (p: { __row: EnvioToken }) => [p.__row],
      tokens: (p: { __row: EnvioToken }) => [tokenSource(p.__row)],
    },

    TokenProjectMarket: {
      id: (m: EnvioToken) => `${m.id}-pmarket`,
      price: (m: EnvioToken) => amt(`${m.id}-pprice`, m.priceUSD),
      fullyDilutedValuation: (m: EnvioToken) => amt(`${m.id}-fdv`, m.fdv),
      marketCap: (m: EnvioToken) => amt(`${m.id}-mcap`, m.fdv),
      pricePercentChange24h: (m: EnvioToken) => amt(`${m.id}-ppc24`, m.priceChange1d, ''),
      priceHighLow: (m: EnvioToken, args: { duration: string; highLow: string }) => {
        const w = durationWindow(args.duration)
        const pts = getTokenPriceHistory(m.id, w.fromTs, w.hourly).map((p) => p.value)
        const v = pts.length ? (args.highLow === 'LOW' ? Math.min(...pts) : Math.max(...pts)) : m.priceUSD
        return amt(`${m.id}-p${args.highLow}-${args.duration}`, v)
      },
      volume: (m: EnvioToken, args: { duration?: string }) =>
        amt(`${m.id}-pvol-${args.duration ?? 'DAY'}`, volumeForDuration(m, args.duration ?? 'DAY')),
      priceHistory: (m: EnvioToken, args: { duration: string }) => {
        const w = durationWindow(args.duration)
        return getTokenPriceHistory(m.id, w.fromTs, w.hourly).map((p) => ({
          id: `${m.id}-pph-${p.timestamp}`,
          timestamp: p.timestamp,
          value: p.value,
          currency: 'USD',
        }))
      },
    },

    V3Pool: {
      token0: (p: PoolSource) => tokenSource(p.__pool.token0),
      token1: (p: PoolSource) => tokenSource(p.__pool.token1),
      totalLiquidity: (p: PoolSource) => amt(`${p.__pool.id}-tl`, p.__pool.tvlUSD),
      totalLiquidityPercentChange24h: (p: PoolSource) => amt(`${p.__pool.id}-tlc`, p.__pool.tvlChange1d, ''),
      cumulativeVolume: (p: PoolSource, args: { duration: string }) =>
        amt(`${p.__pool.id}-cv-${args.duration}`, getPoolCumulativeVolume(p.__pool.id, durationWindow(args.duration).fromTs)),
      historicalVolume: (p: PoolSource, args: { duration: string }) =>
        getPoolVolumeHistory(p.__pool.id, durationWindow(args.duration).fromTs).map((x) => ({
          id: `${p.__pool.id}-hv-${x.timestamp}`,
          timestamp: x.timestamp,
          value: x.value,
          currency: 'USD',
        })),
      priceHistory: (p: PoolSource, args: { duration: string }) =>
        getPoolPriceHistory(p.__pool.id, durationWindow(args.duration).fromTs).map((x) => ({
          id: `${p.__pool.id}-pp-${x.timestamp}`,
          timestamp: x.timestamp,
          token0Price: x.token0Price,
          token1Price: x.token1Price,
        })),
      transactions: (p: PoolSource, args: { first: number; timestampCursor?: number | null }) =>
        getPoolTransactions(p.__pool.id, args.first ?? 100, args.timestampCursor ?? undefined),
    },

    PoolTransaction: {
      id: (tx: EnvioTransaction) => tx.id,
      chain: () => CHAIN,
      protocolVersion: () => 'V3',
      timestamp: (tx: EnvioTransaction) => tx.timestamp,
      hash: (tx: EnvioTransaction) => tx.hash,
      account: (tx: EnvioTransaction) => tx.account,
      token0: (tx: EnvioTransaction) => tokenSourceByAddr(tx.token0),
      token1: (tx: EnvioTransaction) => tokenSourceByAddr(tx.token1),
      token0Quantity: (tx: EnvioTransaction) => String(tx.amount0),
      token1Quantity: (tx: EnvioTransaction) => String(tx.amount1),
      usdValue: (tx: EnvioTransaction) => amt(`${tx.id}-usd`, tx.amountUSD),
      type: (tx: EnvioTransaction) => tx.type,
    },
  },
})

// Re-export so a future detail-page hook can resolve a token's representative pool.
export { getDeepestPoolForToken }
