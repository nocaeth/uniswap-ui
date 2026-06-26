# Gnosis-only Uniswap UI

This repo is a fork of the Uniswap interface, retargeted to **Gnosis Chain (100)
only**. Uniswap's V3 contracts are deployed on Gnosis but Uniswap never shipped a
UI, and its centralized backend (analytics Data API, swap-routing Trading API,
prices) does not serve Gnosis — so those pieces are replaced with self-hosted infra.

## What's implemented in the app (done & typechecked)

- **Gnosis chain support** — `UniverseChainId.Gnosis = 100`, full chain-info file
  (`packages/uniswap/src/features/chains/evm/info/gnosis.ts`), registered in
  `chainInfo.ts`, URL param `gnosis`, logos, theme colors, telemetry element.
- **Contract addresses** — Gnosis (100) added to `@uniswap/sdk-core` address maps
  via `patches/@uniswap%2Fsdk-core@7.17.0.patch` (factory, multicall, quoter,
  swapRouter02, NFT position manager, tickLens, v3Migrator). Verified to resolve at
  runtime. Permit2 resolves to the canonical address with no patch needed.
- **Gnosis-only UX** — `getEnabledChains` returns only Gnosis and
  `getDefaultChainId` defaults to Gnosis (`packages/uniswap/src/features/chains/utils.ts`).
  Other chain definitions are kept in the tree but never selectable. V4 is off
  (`supportsV4: false`); routing is restricted to V3.

> The seed checkout was missing the `tools/uniswap-nx` workspace (referenced by
> `package.json`/`tsconfig`); a minimal stub is committed so `bun install` and
> `tsc -b` resolve. Replace it with the real package if/when available.

## Self-hosted infra (this directory)

| Dir            | Purpose |
|----------------|---------|
| `contracts/`   | Deploy the two missing contracts: **Permit2** (canonical) and **UniversalRouter**. |
| `envio/`       | Envio HyperIndex indexer for Uniswap V3 on Gnosis (powers analytics). |
| `adapter/`     | Service exposing Uniswap's Data API + GraphQL shapes on top of Envio. |
| `docker-compose.yml` + `web.Dockerfile` | Run web + indexer + adapter together. |
| `.env.gnosis.example` | All required env vars. |

### Swap routing (implemented)
Uniswap's Trading API won't quote Gnosis, so swaps are routed client-side via
**QuoterV2**, injected at the existing dependency-injected seams (no UI changes):
`packages/uniswap/src/features/transactions/swap/services/gnosisRouter/`
(quote provider + UniversalRouter tx builder), dispatched in
`features/repositories.ts` and `…/evm/evmSwapInstructionsService.ts`. The quote path
is validated against live Gnosis (QuoterV2 + computePoolAddress). **Set
`REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS`** after deploying UniversalRouter.

### Analytics (implemented)
- Envio indexer: `gnosis/envio/` (config + schema + handlers skeleton).
- Adapter service: `gnosis/adapter/` — implements the **ExploreStats ConnectRPC**
  service (the Explore token + pool tables) on top of Envio, plus a GraphQL
  endpoint for detail/charts. The protobuf mapping is validated against the
  generated `@uniswap/client-explore` message classes.
- App side: set `API_BASE_URL_V2_OVERRIDE` / `GRAPHQL_URL_OVERRIDE` to the adapter;
  Gnosis rows are tagged `chain: 'GNOSIS'` and mapped via `fromGraphQLChain`.

Remaining for analytics: flesh out the Envio handlers (USD pricing, rollups) and
expand the adapter's GraphQL resolvers to cover all token/pool **detail** operations
(the Explore landing tables already work via ConnectRPC).

## Local dev

```bash
bun install
bun web dev          # http://localhost:3000, Gnosis-only
# typecheck:
DISABLE_TSGO=true bunx nx typecheck web
```

## Production

```bash
cp gnosis/.env.gnosis.example gnosis/.env && $EDITOR gnosis/.env
# 1) deploy contracts (gnosis/contracts/README.md)
# 2) bring up the stack
docker compose -f gnosis/docker-compose.yml up -d --build
```

## Verification checklist
- `cast code` / `CheckDeployments.s.sol` → Permit2 + UR have bytecode on Gnosis.
- App boots Gnosis-only; wallet connects to chain 100; `useContract` returns real
  (non-undefined) addresses.
- LP: add/increase/decrease/collect a V3 position against a live Gnosis pool
  (fork via `anvil --fork-url $GNOSIS_RPC_URL`).
- Swap: WXDAI→USDC.e quote matches an independent QuoterV2 call; executes via UR.
- Analytics: Explore tables + charts populate from the adapter.
