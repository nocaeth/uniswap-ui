import { ExploreStatsService } from '@uniswap/client-explore/dist/uniswap/explore/v1/service_connect.js'
import type { ConnectRouter } from '@connectrpc/connect'
import { fetchProtocolStats, fetchTopPools, fetchTopTokens } from './envio.js'
import { toExploreStatsResponse, toProtocolStatsResponse } from './mappers.js'

/**
 * Implements Uniswap's ExploreStatsService (ConnectRPC) on top of Envio so the
 * Explore token + pool tables work for Gnosis. Mounted at the Data API v2 path,
 * which the app reaches via API_BASE_URL_V2_OVERRIDE.
 */
export function registerExploreRoutes(router: ConnectRouter): void {
  router.service(ExploreStatsService, {
    async exploreStats() {
      const [{ Token }, { Pool }] = await Promise.all([fetchTopTokens(), fetchTopPools()])
      return toExploreStatsResponse(Token, Pool)
    },
    async protocolStats() {
      const { ProtocolStats } = await fetchProtocolStats()
      return toProtocolStatsResponse(ProtocolStats[0])
    },
  })
}
