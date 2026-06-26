# Analytics adapter

The UI's Explore / token-detail / pool-detail screens talk to Uniswap's backend
over **two** protocols. Uniswap's backend has no Gnosis, so this service
re-implements just those two contracts on top of a local SQLite store that is
backfilled directly from Gnosis via **Envio HyperSync** (no separate indexer
process or Postgres). Point the app at it with `API_BASE_URL_V2_OVERRIDE` and
`GRAPHQL_URL_OVERRIDE` (see `gnosis/.env.gnosis.example`).

Runs on **Bun** (uses `bun:sqlite`); it will not run on Node.

## Layout

| File | Role |
|------|------|
| `src/backfill.ts` | Indexer. Reads factory/pool/swap/mint/burn logs over HyperSync and writes `data/analytics.db` (token + pool snapshots, daily/hourly rollups, recent tx feed, USD pricing). |
| `src/db.ts` | SQLite schema + connection (`ANALYTICS_DB_PATH`, default `data/analytics.db`). |
| `src/envio.ts` | Read layer over the SQLite store (the `Envio*` types are the in-memory shapes). |
| `src/exploreService.ts` | ConnectRPC `ExploreStats` / `ProtocolStats` / token rankings. |
| `src/dataApiService.ts` | ConnectRPC `ListPositions` / `GetPosition` (via the NonfungiblePositionManager). |
| `src/graphql.ts` | GraphQL (token/pool detail, charts, transactions) served against the upstream schema SDL. |
| `src/server.ts` | HTTP server: ConnectRPC at `/`, GraphQL at `/v1/graphql`, permissive CORS. |
| `schema.graphql` | Vendored copy of `packages/api/.../schema.graphql` (`bun run sync-schema` to refresh; `GRAPHQL_SCHEMA_PATH` to override). |

## Run

```bash
bun install
ENVIO_API_TOKEN=... RPC_GNOSIS=... bun run backfill   # build/refresh data/analytics.db
bun run start                                          # serve on :8081 (PORT to override)
```

In Docker the same image runs both roles — the compose `indexer` service runs
`bun src/backfill.ts` into a shared volume, then `adapter` serves it.

## Notes
- Denominated in USD: V3 spot from `sqrtPriceX96`, Gnosis stables ≈ $1, with a
  sanity clamp on junk-token prices.
- Sparkline `priceHistory` is emitted as `{ start, step, values[] }` to match
  `convertPriceHistoryToPricePoints`.
- v2/v4 GraphQL resolvers return null/empty — Gnosis is V3-only.
