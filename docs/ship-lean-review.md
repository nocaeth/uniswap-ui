# Ship-Lean Review: Gnosis-Only Scope

Date: 2026-06-28

Scope: this review assumes the product should remain a Gnosis-only web app. Anything not serving that goal is a candidate for removal, unless removing it is riskier or more expensive than carrying it.

Method notes:

- Ran the ship-lean repository scan script and verified the main findings directly in code.
- The scan includes local noise from the untracked `universal-router/` checkout; this report calls it out separately and assumes it should not be staged in the app PR.
- This review does not recommend "leaning down" funds-moving code unless there is a separate, test-heavy transaction change.

## Bottom Line

The current change is appropriately scoped: it removes user-facing Uniswap link targets, forces pool discovery to Gnosis V3 data, moves liquidity tick enumeration into the backend adapter, and prefers NOCA/Gnosis token-list assets.

The repo is still larger than a pure Gnosis web app needs. The highest-value next cuts are concrete web-only cleanup: prune CSP/RPC allowlists, constrain or delete all-network sitemap generation, remove unreachable non-Gnosis routes, and delete dead static assets. Do not spend a large cleanup PR on broad package removal yet; most inherited shared infrastructure is cheaper to carry until it imposes build, bundle, or maintenance cost.

## Stakes Map

High-stakes areas:

- Swap execution, approvals, permits, Safe/EIP-5792 batching, Universal Router calls, and transaction sagas.
- Gnosis backend adapter and contracts, including `gnosis/adapter/src/onchain.ts` and `gnosis/contracts/`.
- Any vendored or redeployed router code under `universal-router/` if it is ever brought into the tracked repo.

Medium-stakes areas:

- Explore pool data, token metadata/logo resolution, pool detail pages, position pages, and liquidity charts.
- URL constants and BFF/service URL configuration.
- Chain enablement helpers that enforce Gnosis-only behavior.

Low-stakes areas:

- Disabled help/learn-more callsites.
- Protocol labels, filter affordances, table columns, and display-only stats.
- Docs, comments, generated API metadata, and unused product surfaces.

## Findings

### 1. Ship This Now: User-Facing Uniswap Links Are Disabled

`packages/uniswap/src/constants/urls.ts` centralizes public help/static links behind `DISABLED_PUBLIC_LINK` at lines 22-128. A domain scan still finds Uniswap backend service hosts, CSP allowances, generated API schema text, and comments, but not active app-facing Uniswap support/docs/app links.

Keep the backend service URLs for now. Removing them is not link cleanup; it is a data-plane migration.

### 2. Ship This Now: Liquidity Depth Belongs In The Backend

`gnosis/adapter/src/onchain.ts` now enumerates initialized V3 ticks from the pool bitmap in chunked backend multicalls at lines 64-140, with a short cache at lines 143-158. That is the right location for this work because the frontend should consume liquidity data, not rebuild pool tick state from direct RPC reads.

Watch RPC cost. The full bitmap scan is correct for sparse and full-range Gnosis pools, but if popular pools start returning thousands of ticks, add metrics and consider a longer cache or persisted tick index.

### 3. Keep For Now: V2/V4 Shapes Still Exist In Shared UI

The data path is Gnosis V3-only: `apps/web/src/features/Explore/state/topPools/useBackendSortedTopPools.ts` always requests `ProtocolVersion.V3` at lines 156-163, and `apps/web/src/pages/Explore/ProtocolFilter.tsx` only exposes All/V3 at lines 15-16.

Residual V2/V4 code remains in shared components:

- `apps/web/src/pages/Explore/tables/Pools/PoolTable.tsx` still has V4 currency-id handling at lines 102-118.
- The same table still renders a protocol column at lines 447-462 even though Gnosis pools are always V3.
- `apps/web/src/features/Liquidity/charts/LiquidityPositionRangeChart/LiquidityPositionRangeChart.tsx` still supports V2/V3/V4 chart branches at lines 371-430 and 481-493.

These are reasonable to leave in this PR. They are display/control scaffolding, not active non-Gnosis routing. Strip them opportunistically when touching those screens, with screenshot or unit coverage.

### 4. Revamp Later: The Package Graph Is Still Fork-Sized

The current `apps/` tree is web-only, but `packages/` still includes native/mobile-era packages such as `hashcash-native`, broad API clients, datadog dashboard definitions, sessions, notifications, config tooling, and other inherited shared libraries.

Do not remove these in a funds-moving feature PR. A dependency-pruning PR is only worth it when it reduces build/test time, bundle size, or a concrete maintenance burden. Use Nx project graph data before deleting packages because many imports are indirect.

### 5. Cut Soon: Runtime Allowlists And Generated SEO Are Still Multi-Network

`apps/web/public/csp.json` still allows broad non-Gnosis RPCs and product hosts at lines 30-123, including many chain RPCs plus `*.uniswap.org` and `wss://*.uniswap.org`. Prune this to self, the actual Gnosis RPCs, required wallet providers, and intentionally retained backend API hosts.

`apps/web/scripts/generate-sitemap.js` still queries V2 Ethereum pairs at lines 24-33, loops over non-Gnosis chains at lines 36-51, and calls Uniswap-hosted APIs at lines 67-78 and 131-139. Delete it if static sitemaps are not used, or constrain it to Gnosis-only token/pool URLs.

These are low-stakes, visible product-scope cleanup. They are better next cuts than deleting shared packages.

### 6. Cut Soon: Unreachable Non-Gnosis Routes Still Exist

The swap surface only exposes the Swap tab at `apps/web/src/pages/Swap/index.tsx` lines 181-190, but Buy/Limit flow directories still exist under `apps/web/src/pages/Swap/`. If those flows are not part of NOCA's Gnosis app, delete the directories and then remove residual help-link and modal support.

`apps/web/src/pages/RouteDefinitions.tsx` still has a Solana WSOL redirect at lines 127-133, V2/V4 position routes at lines 208-225, and legacy V2 add/remove routes at lines 269-299. Keep redirects only if they are needed for historical URLs. Otherwise, remove them after confirming no production links depend on them.

### 7. Delete: Dead QR Asset

`apps/web/src/components/WalletOneLinkQR.tsx` is a 3,125-line inline SVG component, and `rg` finds no imports outside its own export. It is a straightforward deletion candidate if wallet-download surfaces remain disabled.

### 8. Keep Out Of This PR: `universal-router/` Is Untracked And Huge

The untracked `universal-router/` directory includes its own `.git`, `node_modules`, Foundry artifacts, contracts, broadcasts, and caches. If router source is needed long-term, track only the minimum source/deploy artifacts under a deliberate location or submodule. Do not accidentally add the full directory to this app PR.

### 9. Keep For Now: Disabled Help Call-Sites Are Cheaper Than Chasing

Many components still import `UniswapHelpUrls` or `LearnMoreLink`, but the URL constants are blank and the link components tolerate empty URLs. The dead callsites are low-risk clutter. Removing every one now would create broad churn for little product value.

Better cleanup sequence:

1. Delete entire unsupported product surfaces if they are not part of the Gnosis app.
2. Then remove their help-link callsites with the screen deletion.
3. Leave isolated blank help URLs alone until they appear in user testing.

## Next Lean Cuts

Recommended low-risk cuts:

- Remove the protocol column from the Explore pools table once no other route consumes it.
- Remove V2/V4 options from add-liquidity and position chart props where the callsites are provably Gnosis V3-only.
- Prune CSP and sitemap generation to Gnosis-only behavior.
- Delete Buy/Limit/off-ramp and unrelated wallet/download surfaces if they still appear in navigation or route definitions.
- Delete `WalletOneLinkQR.tsx` if no download QR flow imports it.
- Keep `UniswapHelpUrls` blank until NOCA-owned docs exist.

Avoid broad cuts for now:

- Do not simplify approval, permit, swap callback, Safe batching, or router code without focused transaction tests.
- Do not delete shared packages by name alone; first prove they are unused in the Nx graph and production bundle.
- Do not track the untracked `universal-router/` tree as-is.

## Verification Notes

- Focused web tests passed for the touched Explore stats, token logo, and liquidity chart utilities.
- `gnosis-analytics-adapter:typecheck` passed.
- `uniswap:test` passed.
- `bun g:format`, `bun g:lint:fix`, and `bun g:typecheck` passed.
- The aggregate `bun g:test` and direct full `web:test` run did not produce a final summary in this environment; both progressed through many passing suites and then stopped emitting output until interrupted. Treat full web test completion as the remaining verification gap.
