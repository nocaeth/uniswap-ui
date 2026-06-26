import { ExploreStatsService } from '@uniswap/client-explore/dist/uniswap/explore/v1/service_connect.js'
import type { ConnectRouter, ServiceImpl } from '@connectrpc/connect'
import type { ServiceType } from '@bufbuild/protobuf'
import { fetchProtocolStats, fetchTopPools, fetchTopTokens } from './envio.js'
import { toExploreStatsResponse, toProtocolStatsResponse } from './mappers.js'

// @uniswap/client-explore ships CJS-compiled type decls, so under NodeNext the
// ExploreStatsService value carries `@bufbuild/protobuf` types resolved in CJS
// mode, which TS treats as distinct from connect's ESM-mode view of the *same*
// package (one install, verified). Cast through ServiceType to bridge the dual
// resolution-mode views — the runtime types are identical.
const Service = ExploreStatsService as unknown as ServiceType

/**
 * Implements Uniswap's ExploreStatsService (ConnectRPC) on top of the backfill
 * snapshot so the Explore token + pool tables work for Gnosis. Mounted at the
 * Data API v2 path, which the app reaches via API_BASE_URL_V2_OVERRIDE.
 */
export function registerExploreRoutes(router: ConnectRouter): void {
  router.service(Service, {
    async exploreStats() {
      const [{ Token }, { Pool }] = await Promise.all([fetchTopTokens(), fetchTopPools()])
      return toExploreStatsResponse(Token, Pool)
    },
    async protocolStats() {
      const { ProtocolStats } = await fetchProtocolStats()
      return toProtocolStatsResponse(ProtocolStats[0])
    },
  } as unknown as ServiceImpl<ServiceType>)
}
