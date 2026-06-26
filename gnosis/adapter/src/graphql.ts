import { createSchema } from 'graphql-yoga'
import { fetchTokenDayData, fetchTopPools } from './envio.js'

/**
 * GraphQL endpoint for token/pool detail + charts.
 *
 * NOTE: the production interface sends operations defined against Uniswap's full
 * GraphQL schema (packages/api/src/clients/graphql/web/*.graphql). To make the
 * detail pages render, this schema must be expanded to cover those operations and
 * resolve them from Envio. The resolvers below implement a representative slice
 * (token price history) to establish the pattern; extend as detail pages are
 * brought online. The Explore landing tables do NOT depend on this endpoint — they
 * are served by the ExploreStats ConnectRPC service (see exploreService.ts).
 */
export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type PricePoint {
      timestamp: Int!
      value: Float!
    }
    type TokenChart {
      address: String!
      priceHistory: [PricePoint!]!
    }
    type PoolRow {
      id: String!
      feeTier: Int!
      tvlUSD: Float!
      volumeUSD: Float!
    }
    type Query {
      tokenChart(address: String!, days: Int): TokenChart!
      topPools(limit: Int): [PoolRow!]!
    }
  `,
  resolvers: {
    Query: {
      tokenChart: async (_: unknown, args: { address: string; days?: number }) => {
        const { TokenDayData } = await fetchTokenDayData(args.address, args.days ?? 365)
        return {
          address: args.address,
          priceHistory: TokenDayData.map((d) => ({ timestamp: d.date, value: d.priceUSD })),
        }
      },
      topPools: async (_: unknown, args: { limit?: number }) => {
        const { Pool } = await fetchTopPools(args.limit ?? 100)
        return Pool.map((p) => ({
          id: p.id,
          feeTier: p.feeTier,
          tvlUSD: p.totalValueLockedUSD,
          volumeUSD: p.volumeUSD,
        }))
      },
    },
  },
})
