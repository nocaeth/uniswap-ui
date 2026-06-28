import { SearchService } from '@uniswap/client-data-api/dist/data/v1/search_connect.js'
import { SearchTokensRequest, SearchTokensResponse } from '@uniswap/client-data-api/dist/data/v1/search_pb.js'
import { Pool as SearchPool, PoolTokenData, SearchType, Token as SearchToken } from '@uniswap/client-data-api/dist/data/v1/searchTypes_pb.js'
import type { ServiceType } from '@bufbuild/protobuf'
import type { ConnectRouter, ServiceImpl } from '@connectrpc/connect'
import { fetchExploreStats } from './envio.js'
import type { EnvioPool, EnvioToken } from './envio.js'

// Gnosis-only deployment. Uniswap's hosted SearchService (data.v1.SearchService)
// has no chain-100 coverage, so serve token + pool search from the same indexer
// snapshot that powers Explore/TokenRankings. The client transforms the flat
// tokens[] shape into multichainTokens[] (transformSearchToMultichain), so we
// only populate tokens[] and pools[].
const GNOSIS_CHAIN_ID = 100
const DEFAULT_SIZE = 20

function matches(query: string, ...fields: string[]): boolean {
  return fields.some((f) => f.toLowerCase().includes(query))
}

function toSearchToken(t: EnvioToken): SearchToken {
  return new SearchToken({
    tokenId: t.id,
    chainId: GNOSIS_CHAIN_ID,
    address: t.id,
    decimals: t.decimals,
    symbol: t.symbol,
    name: t.name,
    standard: 'ERC20',
    projectName: t.name,
    logoUrl: t.logo,
  })
}

function toPoolTokenData(t: EnvioToken): PoolTokenData {
  return new PoolTokenData({
    chainId: GNOSIS_CHAIN_ID,
    address: t.id,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logoUrl: t.logo,
  })
}

function toSearchPool(p: EnvioPool): SearchPool {
  return new SearchPool({
    id: p.id,
    chainId: GNOSIS_CHAIN_ID,
    protocolVersion: 'V3',
    feeTier: p.feeTier,
    token0: toPoolTokenData(p.token0),
    token1: toPoolTokenData(p.token1),
    volumeUsd24hr: p.volume1d,
  })
}

function searchTokens(req: SearchTokensRequest): SearchTokensResponse {
  const query = req.searchQuery.trim().toLowerCase()
  if (!query) {
    return new SearchTokensResponse({ tokens: [], pools: [] })
  }
  const size = req.size > 0 ? req.size : DEFAULT_SIZE

  // Degrade to empty results rather than a 500 if the snapshot DB is cold/missing or a read
  // throws — the UI shows "no results" instead of "Couldn't load search results".
  try {
    const { tokens, pools } = fetchExploreStats()

    if (req.searchType === SearchType.POOL) {
      const matched = pools
        .filter((p) =>
          matches(query, p.id, p.token0.symbol, p.token1.symbol, p.token0.name, p.token1.name, `${p.token0.symbol}/${p.token1.symbol}`),
        )
        .sort((a, b) => b.tvlUSD - a.tvlUSD)
        .slice(0, size)
      return new SearchTokensResponse({ tokens: [], pools: matched.map(toSearchPool) })
    }

    const matched = tokens
      .filter((t) => matches(query, t.id, t.symbol, t.name))
      .sort((a, b) => b.tvlUSD - a.tvlUSD)
      .slice(0, size)
    return new SearchTokensResponse({ tokens: matched.map(toSearchToken), pools: [] })
  } catch {
    return new SearchTokensResponse({ tokens: [], pools: [] })
  }
}

// Cast through ServiceType to bridge the dual CJS/ESM resolution-mode views,
// mirroring exploreService.ts / dataApiService.ts.
const Service = SearchService as unknown as ServiceType

export function registerSearchRoutes(router: ConnectRouter): void {
  router.service(Service, {
    searchTokens,
  } as unknown as ServiceImpl<ServiceType>)
}
