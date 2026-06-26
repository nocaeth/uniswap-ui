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

## Remaining app work

### Swap routing (not yet wired)
Uniswap's Trading API won't quote Gnosis. Replace it with a **client-side V3
router** at the existing dependency-injected seams — no UI changes:

1. New quote provider conforming to `TradingApiClient['fetchQuote']`: generate
   candidate V3 paths over a base set (WXDAI, USDC.e, USDT, WETH) at fee tiers
   100/500/3000/10000, price them via **QuoterV2** (deployed: `0x7E9c…`) over
   Multicall, read each hop's `slot0`+`liquidity`, and return a
   `ClassicQuoteResponse` (`Routing.CLASSIC`) matching
   `packages/api/src/clients/trading/tradeTypes.ts`.
   Inject where `createTradeRepository` is constructed
   (`packages/uniswap/src/features/transactions/swap/services/tradeService/tradeRepository.ts`).
2. Tx builder paralleling `createLegacyEVMSwapRepository`
   (`…/review/services/swapTxAndGasInfoService/evm/evmSwapRepository.ts`): build UR
   calldata via `@uniswap/universal-router-sdk` `SwapRouter.swapCallParameters`,
   reading the **deployed UR address** from chain config (avoids an SDK patch).
3. Stub `fetchCheckApproval` from on-chain Permit2/allowance reads.
4. Force `protocols: [ProtocolItems.V3]`.

### Analytics wiring
Stand up `envio/` + `adapter/`, then set `API_BASE_URL_V2_OVERRIDE` /
`GRAPHQL_URL_OVERRIDE`. No app code changes required (see `adapter/README.md`).

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
