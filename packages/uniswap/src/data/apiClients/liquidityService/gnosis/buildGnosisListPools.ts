import { PartialMessage } from '@bufbuild/protobuf'
import { createQueryOptions } from '@connectrpc/connect-query'
import { exploreStats } from '@uniswap/client-explore/dist/uniswap/explore/v1/service-ExploreStatsService_connectquery'
import { ExploreStatsResponse, PoolStats } from '@uniswap/client-explore/dist/uniswap/explore/v1/service_pb'
import { ListPoolsRequest, ListPoolsResponse } from '@uniswap/client-liquidity/dist/uniswap/liquidity/v2/api_pb'
import { PoolSortBy, PoolSummary, TokenMetadata } from '@uniswap/client-liquidity/dist/uniswap/liquidity/v2/types_pb'
import { Protocols } from '@uniswap/client-liquidity/dist/uniswap/liquidity/v1/types_pb'
import { SharedQueryClient } from '@universe/api'
import { FeeAmount, TICK_SPACINGS } from '@uniswap/v3-sdk'
import { uniswapGetTransport } from 'uniswap/src/data/rest/base'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { ONE_HOUR_MS, ONE_MINUTE_MS } from 'utilities/src/time/time'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis

function tickSpacingForFee(feeTier: number | undefined): number | undefined {
  return feeTier !== undefined && feeTier in TICK_SPACINGS ? TICK_SPACINGS[feeTier as FeeAmount] : undefined
}

function toTokenMetadata(token?: PoolStats['token0']): TokenMetadata {
  return new TokenMetadata({
    symbol: token?.symbol,
    name: token?.name,
    decimals: token?.decimals,
    logoUrl: token?.logo,
  })
}

function toPoolSummary(ps: PoolStats): PoolSummary {
  return new PoolSummary({
    poolIdentifier: ps.id,
    chainId: GNOSIS_CHAIN_ID,
    protocolVersion: Protocols.V3,
    token0Address: ps.token0?.address ?? '',
    token1Address: ps.token1?.address ?? '',
    feeTier: ps.feeTier,
    tvlUsd: ps.totalLiquidity?.value ?? 0,
    volumeUsd1d: ps.volume1Day?.value ?? 0,
    tickSpacing: tickSpacingForFee(ps.feeTier),
    token0Metadata: toTokenMetadata(ps.token0),
    token1Metadata: toTokenMetadata(ps.token1),
  })
}

function sortValue(ps: PoolStats, sortBy: PoolSortBy | undefined): number {
  // ExploreStats has no APR, so APR sort falls back to TVL ordering.
  if (sortBy === PoolSortBy.VOLUME_USD) {
    return ps.volume1Day?.value ?? 0
  }
  return ps.totalLiquidity?.value ?? 0
}

/**
 * Add-liquidity pool browser for Gnosis. Uniswap's hosted LiquidityService.ListPools
 * has no chain-100 coverage and getListPoolsQueryOptions has no Gnosis branch, so
 * source the pool list from the same adapter-served Explore stats that power the
 * pools tables, then map PoolStats -> v2 PoolSummary. Gnosis is V3-only with a small
 * pool universe, so all matches return in a single page (no cursor pagination).
 */
export async function buildGnosisListPools(params: PartialMessage<ListPoolsRequest>): Promise<ListPoolsResponse> {
  const response = await SharedQueryClient.fetchQuery({
    ...createQueryOptions(
      exploreStats,
      { chainId: GNOSIS_CHAIN_ID.toString() },
      { transport: uniswapGetTransport },
    ),
    staleTime: ONE_MINUTE_MS,
    gcTime: ONE_HOUR_MS,
  })
  const poolStats = (response as ExploreStatsResponse).stats?.poolStats ?? []

  const token0 = params.token0Address?.toLowerCase()
  const token1 = params.token1Address?.toLowerCase()
  const single = params.tokenAddress?.toLowerCase()

  const filtered = poolStats.filter((ps) => {
    const a = ps.token0?.address.toLowerCase()
    const b = ps.token1?.address.toLowerCase()
    if (token0 && token1) {
      return (a === token0 && b === token1) || (a === token1 && b === token0)
    }
    if (single) {
      return a === single || b === single
    }
    return true
  })

  const sorted = [...filtered].sort((x, y) => sortValue(y, params.sortBy) - sortValue(x, params.sortBy))
  if (params.ascending) {
    sorted.reverse()
  }

  return new ListPoolsResponse({ pools: sorted.map(toPoolSummary) })
}
