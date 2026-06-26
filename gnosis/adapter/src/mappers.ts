import {
  Amount,
  ExplorerStats,
  ExploreStatsResponse,
  PoolStats,
  ProtocolStatsResponse,
  TokenStats,
} from '@uniswap/client-explore/dist/uniswap/explore/v1/service_pb.js'
import type { EnvioPool, EnvioProtocolStats, EnvioToken } from './envio.js'

// The app maps this onto UniverseChainId.Gnosis via fromGraphQLChain('GNOSIS').
const GNOSIS_CHAIN = 'GNOSIS'

function usd(value: number | undefined): Amount {
  return new Amount({ currency: 'USD', value: value ?? 0 })
}

export function toTokenStats(t: EnvioToken): TokenStats {
  return new TokenStats({
    chain: GNOSIS_CHAIN,
    address: t.id,
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    price: usd(t.derivedXDAI),
    volume1Day: usd(t.volumeUSD),
  })
}

export function toPoolStats(p: EnvioPool): PoolStats {
  return new PoolStats({
    id: p.id,
    chain: GNOSIS_CHAIN,
    protocolVersion: 'V3',
    feeTier: p.feeTier,
    totalLiquidity: usd(p.totalValueLockedUSD),
    volume1Day: usd(p.volumeUSD),
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

export function toProtocolStatsResponse(_stats: EnvioProtocolStats | undefined): ProtocolStatsResponse {
  // ProtocolStatsResponse carries historical protocol TVL/volume series; populate
  // from ProtocolStats + day-data once those rollups are indexed. Empty is valid.
  return new ProtocolStatsResponse({})
}
