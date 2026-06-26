import { ExploreStatsService } from '@uniswap/client-explore/dist/uniswap/explore/v1/service_connect.js'
import type { ConnectRouter, ServiceImpl } from '@connectrpc/connect'
import type { ServiceType } from '@bufbuild/protobuf'
import { fetchExploreStats, fetchProtocolStats } from './envio.js'
import { toExploreStatsResponse, toProtocolStatsResponse, toTokenRankingsResponse } from './mappers.js'

// @uniswap/client-explore ships CJS-compiled type decls, so under NodeNext the
// ExploreStatsService value carries `@bufbuild/protobuf` types resolved in CJS
// mode, which TS treats as distinct from connect's ESM-mode view of the *same*
// package (one install, verified). Cast through ServiceType to bridge the dual
// resolution-mode views — the runtime types are identical.
const Service = ExploreStatsService as unknown as ServiceType

/**
 * Implements Uniswap's ExploreStatsService (ConnectRPC) on top of the SQLite
 * analytics store so the Explore token + pool tables, the summary cards, and
 * search/trending work for Gnosis. Mounted at the Data API v2 path, which the app
 * reaches via API_BASE_URL_V2_OVERRIDE.
 */
export function registerExploreRoutes(router: ConnectRouter): void {
  router.service(Service, {
    exploreStats() {
      const { tokens, pools } = fetchExploreStats()
      return toExploreStatsResponse(tokens, pools)
    },
    protocolStats() {
      return toProtocolStatsResponse(fetchProtocolStats())
    },
    tokenRankings() {
      const { tokens } = fetchExploreStats()
      return toTokenRankingsResponse(tokens)
    },
  } as unknown as ServiceImpl<ServiceType>)
}
