# Analytics adapter

The UI's Explore / token-detail / pool-detail screens talk to Uniswap's backend
over **two** protocols. Since Uniswap's backend has no Gnosis, this service
re-implements just those two contracts on top of the Envio indexer
(`gnosis/envio`). Point the app at it with `API_BASE_URL_V2_OVERRIDE` and
`GRAPHQL_URL_OVERRIDE` (see `gnosis/.env.gnosis.example`).

## Endpoints to implement

### 1. ConnectRPC / protobuf — Data API (token & pool tables)
Base path `…/v2/data.v1.DataApiService`. The Explore tables call `ExploreStats`
(and optionally `ListTokens` / `ListTopPools`). Emit the exact protobuf messages
from `@uniswap/client-explore` / `@uniswap/client-data-api`:
- `ExploreStatsResponse` → `TokenStats[]` (address, chainId=100, symbol, name,
  decimals, logo, price, pricePercentChange{1h,1d,…}, volume{1h,1d,1w,1m,1y}, TVL,
  marketCap, priceHistory buckets) and `PoolStats[]` (address, protocolVersion=V3,
  token0/1, feeTier, tvl, volume{1d,1w,30d}, apr, txCount).

Simplification: set `V2EndpointsTokens=false` / `V2EndpointsPools=false` (feature
flags) so only `ExploreStats` must be implemented on this transport.

### 2. GraphQL — token/pool detail + charts
Serve the operations the app sends (see `packages/api/src/clients/graphql/web/`):
`token.graphql`, `tokenCharts.graphql` (price/volume/TVL history by duration),
`pool.graphql`, `transactions.graphql`. Resolve them from Envio entities
(`TokenDayData`/`TokenHourData`/`PoolDayData`/`Transaction`). Matching the schema in
`packages/api/src/clients/graphql/schema.graphql` lets the Apollo cache work
unchanged.

## Cheaper fallback
If implementing ConnectRPC is too heavy, rewrite the single hook
`packages/uniswap/src/data/rest/exploreStats.ts` to call Envio (REST/GraphQL) and
map the result into `ExploreStatsResponse`-shaped objects. That removes the protobuf
requirement for the tables; charts/detail still use the GraphQL endpoint above.

## Notes
- Denominate everything in USD using the indexer's price logic (Gnosis stables ≈ $1).
- Sparkline `priceHistory` must be `{ start, step, values[] }` to match
  `convertPriceHistoryToPricePoints` (`useTopTokensLegacy.ts`).
- A small Node service (e.g. `@connectrpc/connect-node` + a GraphQL server such as
  graphql-yoga, both proxying Envio's Hasura GraphQL at `:8080`) is sufficient.
