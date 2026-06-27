import {
  Amount,
  DailyProtocolTvl,
  ExplorerStats,
  ExploreStatsResponse,
  HistoricalProtocolVolume,
  Image,
  PoolStats,
  PriceHistory,
  ProtocolStatsResponse,
  TimestampedAmount,
  TokenProject,
  TokenRankingsList,
  TokenRankingsResponse,
  TokenRankingsStat,
  TokenStats,
  VolumeSplit,
} from '@uniswap/client-explore/dist/uniswap/explore/v1/service_pb.js'
import type { EnvioPool, EnvioPriceHistory, EnvioProtocolSeries, EnvioToken } from './envio.js'

// The app maps this onto UniverseChainId.Gnosis via fromGraphQLChain('GNOSIS').
const GNOSIS_CHAIN = 'GNOSIS'
const DAY = 86400

function usd(value: number | undefined): Amount {
  return new Amount({ currency: 'USD', value: value ?? 0 })
}

/** Percent-change amount (no currency; the app reads `.value`). */
function pct(value: number | undefined): Amount {
  return new Amount({ value: value ?? 0 })
}

function priceHistory(h: EnvioPriceHistory | undefined): PriceHistory | undefined {
  if (!h || h.values.length === 0) {
    return undefined
  }
  return new PriceHistory({ start: h.start, end: h.end, step: h.step, values: h.values })
}

export function toTokenStats(t: EnvioToken): TokenStats {
  return new TokenStats({
    chain: GNOSIS_CHAIN,
    address: t.id,
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    logo: t.logo || undefined,
    price: usd(t.priceUSD),
    fullyDilutedValuation: usd(t.fdv),
    volume1Hour: usd(t.volume1h),
    volume1Day: usd(t.volume1d),
    volume1Week: usd(t.volume7d),
    volume1Month: usd(t.volume30d),
    volume1Year: usd(t.volume1y),
    pricePercentChange1Hour: pct(t.priceChange1h),
    pricePercentChange1Day: pct(t.priceChange1d),
    pricePercentChange1Week: pct(t.priceChange1w),
    pricePercentChange1Month: pct(t.priceChange1m),
    pricePercentChange1Year: pct(t.priceChange1y),
    priceHistoryHour: priceHistory(t.priceHistory?.hour),
    priceHistoryDay: priceHistory(t.priceHistory?.day),
    priceHistoryWeek: priceHistory(t.priceHistory?.week),
    priceHistoryMonth: priceHistory(t.priceHistory?.month),
    priceHistoryYear: priceHistory(t.priceHistory?.year),
    standard: 'ERC20',
    project: t.logo
      ? new TokenProject({ name: t.name, logo: new Image({ url: t.logo }) })
      : undefined,
  })
}

export function toPoolStats(p: EnvioPool): PoolStats {
  return new PoolStats({
    id: p.id,
    chain: GNOSIS_CHAIN,
    protocolVersion: 'V3',
    feeTier: p.feeTier,
    totalLiquidity: usd(p.tvlUSD),
    volume1Day: usd(p.volume1d),
    volume1Week: usd(p.volume7d),
    volume30Day: usd(p.volume30d),
    txCount: p.txCount,
    token0: toTokenStats(p.token0),
    token1: toTokenStats(p.token1),
  })
}

export function toExploreStatsResponse(tokens: EnvioToken[], pools: EnvioPool[]): ExploreStatsResponse {
  const poolStats = pools.map(toPoolStats)
  return new ExploreStatsResponse({
    stats: new ExplorerStats({
      tokenStats: tokens.map(toTokenStats),
      poolStats,
      poolStatsV3: poolStats,
    }),
  })
}

export function toProtocolStatsResponse(series: EnvioProtocolSeries): ProtocolStatsResponse {
  const now = Math.floor(Date.now() / 1000)
  const ts = (rows: { timestamp: number; value: number }[]): TimestampedAmount[] =>
    rows.map((r) => new TimestampedAmount({ timestamp: r.timestamp, value: r.value, currency: 'USD' }))
  const since = (rows: { timestamp: number; value: number }[], from: number): { timestamp: number; value: number }[] =>
    rows.filter((r) => r.timestamp >= from)

  return new ProtocolStatsResponse({
    dailyProtocolTvl: new DailyProtocolTvl({ v3: ts(series.dailyTvl) }),
    historicalProtocolVolume: new HistoricalProtocolVolume({
      Month: new VolumeSplit({ v3: ts(since(series.dailyVolume, now - 30 * DAY)) }),
      Year: new VolumeSplit({ v3: ts(since(series.dailyVolume, now - 365 * DAY)) }),
      Max: new VolumeSplit({ v3: ts(series.dailyVolume) }),
    }),
  })
}

/**
 * tokenRankings powers search/trending/favorites. Gnosis is V3-only; we build
 * one ranked list per ranking type from the snapshot tokens.
 */
export function toTokenRankingsResponse(tokens: EnvioToken[], limit = 100): TokenRankingsResponse {
  const stat = (t: EnvioToken): TokenRankingsStat =>
    new TokenRankingsStat({
      chain: GNOSIS_CHAIN,
      address: t.id,
      name: t.name,
      symbol: t.symbol,
      logo: t.logo || undefined,
      decimals: t.decimals,
      price: usd(t.priceUSD),
      fullyDilutedValuation: usd(t.fdv),
      pricePercentChange1Day: pct(t.priceChange1d),
      volume1Day: usd(t.volume1d),
      totalValueLocked: usd(t.tvlUSD),
    })
  const ranked = (cmp: (a: EnvioToken, b: EnvioToken) => number): TokenRankingsList =>
    new TokenRankingsList({ tokens: [...tokens].sort(cmp).slice(0, limit).map(stat) })

  return new TokenRankingsResponse({
    tokenRankings: {
      TRENDING: ranked((a, b) => b.volume1d - a.volume1d),
      VOLUME: ranked((a, b) => b.volume1d - a.volume1d),
      TOTAL_VALUE_LOCKED: ranked((a, b) => b.tvlUSD - a.tvlUSD),
      MARKET_CAP: ranked((a, b) => b.fdv - a.fdv),
      PRICE_PERCENT_CHANGE_1_DAY_DESC: ranked((a, b) => b.priceChange1d - a.priceChange1d),
      PRICE_PERCENT_CHANGE_1_DAY_ASC: ranked((a, b) => a.priceChange1d - b.priceChange1d),
    },
  })
}
