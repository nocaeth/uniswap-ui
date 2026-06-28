# Ship-Lean Review: Gnosis-Only Scope

Generated: 2026-06-28 14:49:45 UTC  
Base commit: `cb309adb8`

Scope: this review assumes the product should remain a Gnosis-only web app. Anything not serving that goal is a candidate for removal, unless removing it is riskier or more expensive than carrying it.

Method notes:

- Read the repo overview, package scripts, Gnosis compose file, recent git history, and the ship-lean rubric.
- Ran the ship-lean scan; it produced useful high-stakes and file-size sections, then was stopped because it was still walking vendored and untracked router trees.
- Verified the findings below with targeted `rg` and line-numbered source reads.
- Did not spawn sub-agents because the available delegation tool is restricted to explicit user requests for parallel agents.

## Bottom Line

This PR is now scoped correctly for a Gnosis-only launch: liquidity tick enumeration lives in the backend adapter, Explore pools are V3-only, token logos prefer the NOCA Gnosis token list, legacy fallback token lists point at the NOCA list, and the unused wallet QR SVG has been deleted.

The highest-value next cuts are not package-wide refactors. Prune the web CSP/sitemap and unreachable non-Gnosis routes first; leave broad shared-package deletion for a separate cleanup with Nx graph evidence.

## Stakes Map

High-stakes:

- Swap execution, approvals, permits, Safe/EIP-5792 batching, Universal Router calls, transaction sagas, and any code that signs or broadcasts.
- Gnosis adapter liquidity and portfolio endpoints when they feed transaction review or position management.
- `gnosis/contracts/` and any tracked router deployment source.

Medium-stakes:

- Explore pool data, token metadata/logo resolution, token/pool detail pages, position pages, and liquidity charts.
- URL/service configuration and chain enablement logic that defines the Gnosis-only app boundary.

Low-stakes:

- Disabled help-link callsites, display-only protocol labels, table columns, route redirects, generated SEO scripts, docs, comments, and unused static assets.

## Findings

### 1. FINE: Do Not Lean Down Funds-Moving Code In This PR

`apps/web/src/features/Swap/hooks/useSendCallback.ts`, `apps/web/src/hooks/usePermitAllowance.ts`, `apps/web/src/hooks/useUniversalRouter.ts`, and the Gnosis swap service files remain high-stakes because they touch approvals, permits, routing, or broadcast. Keep the current transaction-specific tests and avoid broad simplification here unless the next PR is explicitly a transaction hardening PR.

The ship-lean move: leave it. [HIGH]

### 2. FINE: Backend Liquidity Is In The Right Place

`gnosis/adapter/src/onchain.ts:64` enumerates initialized V3 bitmap words, `gnosis/adapter/src/onchain.ts:92` reads tick data in chunks, and `gnosis/adapter/src/onchain.ts:143` caches tick reads briefly. This is the right ownership boundary: the frontend should consume pool liquidity, not rebuild full tick state through browser RPC reads.

The ship-lean move: ship it, then add metrics/cache tuning only if RPC cost becomes visible. [HIGH]

### 3. FINE: Token Lists And Logos Are Now Gnosis-First

`apps/web/src/constants/lists.ts:1` points the legacy inactive token-list updater to `GNOSIS_TOKEN_LIST_SOURCE_URI`, not a non-Gnosis fallback. `packages/uniswap/src/features/dataApi/utils/buildCurrency.ts:111` now prefers NOCA token-list logos for known Gnosis tokens, while non-Gnosis backend logos remain untouched by test coverage.

This is a good narrow fix for the "NOCA token list over CoW/remote assets" requirement without deleting shared token-list machinery across the repo.

The ship-lean move: ship it. [MEDIUM]

### 4. FINE: Pool APR Rows Now Have Token IDs Outside V4

`apps/web/src/pages/Explore/tables/Pools/PoolTable.tsx:102` now builds token currency IDs for every pool row with actual token addresses, while preserving the native-token fallback only for V4. That lets V3 boosted APR rows feed token metadata to incentive UI instead of only rendering a number.

The ship-lean move: ship it. [MEDIUM]

### 5. OVER-BUILT: Runtime CSP Is Still Multi-Network

`apps/web/public/csp.json:30` still allows broad RPC and product hosts, including Arbitrum, Base, Optimism, BNB, Polygon, Blast, Zora, Unichain, and `*.uniswap.org` / `wss://*.uniswap.org` at `apps/web/public/csp.json:50` and `apps/web/public/csp.json:117`.

For a Gnosis-only app this is too permissive and makes the deployment look broader than it is. The cure is cheap: restrict `connectSrc` to self, the actual Gnosis RPCs, required wallet providers, NOCA/backend hosts, the NOCA token-list asset host, and intentionally retained observability services.

The ship-lean move: prune in a focused config PR. ~1h, fully reversible. [LOW]

### 6. OVER-BUILT: Sitemap Generation Still Calls Uniswap And All Networks

`apps/web/scripts/generate-sitemap.js:24` still queries V2 Ethereum pairs, `apps/web/scripts/generate-sitemap.js:36` lists many non-Gnosis chains, `apps/web/scripts/generate-sitemap.js:67` calls the Uniswap Explore gateway with `ALL_NETWORKS`, and `apps/web/scripts/generate-sitemap.js:131` calls the Uniswap GraphQL API for every chain.

For `swap.gno.now`, either delete this script if sitemap generation is unused or rewrite it to use the Gnosis adapter and Gnosis-only token/pool URLs.

The ship-lean move: delete or constrain to Gnosis. ~1-2h, fully reversible. [LOW]

### 7. SPECULATIVE: Non-Gnosis Routes Still Exist Behind Redirects And Tests

`apps/web/src/pages/RouteDefinitions.tsx:127` keeps a Solana WSOL redirect, `apps/web/src/pages/RouteDefinitions.tsx:208` and `apps/web/src/pages/RouteDefinitions.tsx:221` keep V2/V4 position routes, and `apps/web/src/pages/RouteDefinitions.tsx:269` / `apps/web/src/pages/RouteDefinitions.tsx:288` keep legacy V2 add/remove routes. `apps/web/src/pages/paths.ts` mirrors those paths, and route snapshots/E2E tests still cover them.

These are not worth deleting inside the liquidity/logo PR because the blast radius is route snapshots, metadata helpers, and Playwright deep links. They are still the right next UI cleanup if production has no historical URLs to preserve.

The ship-lean move: remove routes in a route-only PR, or keep explicit redirects only for known historical URLs. ~0.5-1d with tests. [LOW]

### 8. SPECULATIVE: Buy/Limit And Solana Wallet Surfaces Remain In Source

The visible swap tab is already Swap-only, but `apps/web/src/pages/Swap/Buy/` and `apps/web/src/pages/Swap/Limit/` remain in the tree, and wallet connection components still include Solana-specific prompts. They are dead weight for a Gnosis-only app unless a hidden route or test still imports them.

The ship-lean move: delete whole unsupported surfaces, not scattered help links. Do this after route cleanup so imports fail loudly. [LOW]

### 9. FINE: User-Facing Uniswap Links Are Disabled

`packages/uniswap/src/constants/urls.ts:24` centralizes public help links behind `DISABLED_PUBLIC_LINK`, and `packages/uniswap/src/constants/urls.ts:94` points web interface URLs at `https://swap.gno.now`. A source scan still finds `uniswap.org` in backend service hosts, CSP, generated schemas, comments, and tests; those are not active user-facing links.

The ship-lean move: leave blank help URLs until NOCA-owned docs exist. Separately prune CSP and sitemap because those are still active configuration/scripts. [LOW]

### 10. FINE: Dead QR Asset Was Deleted

`apps/web/src/components/WalletOneLinkQR.tsx` was a 3,125-line inline SVG with no imports outside its own export. It has been deleted in this branch.

The ship-lean move: ship it. [LOW]

### 11. SPECULATIVE: Keep `universal-router/` Out Of This PR

The untracked `universal-router/` checkout is huge and includes vendored contracts, caches, tests, and deployment artifacts. The scan shows it dominates high-stakes and file-size output. If router source needs to live in this repo, track only the minimal deployment source/artifacts under a deliberate path or submodule.

The ship-lean move: do not stage it. [HIGH if tracked]

## Next Lean Cuts

Recommended:

- Prune `apps/web/public/csp.json` to the actual Gnosis deployment.
- Delete or rewrite `apps/web/scripts/generate-sitemap.js` for the Gnosis adapter.
- Remove unsupported V2/V4/Solana route definitions after deciding whether any production redirects must survive.
- Delete Buy/Limit/off-ramp and Solana wallet surfaces once route cleanup proves they are unreachable.
- Remove the Explore pools protocol column only after route/data cleanup proves there is no non-V3 table consumer.

Avoid for now:

- Do not simplify approval, permit, Safe batching, router, or swap callback code without focused transaction tests.
- Do not delete shared packages by name alone; first prove they are unused in the Nx graph and production bundle.
- Do not stage the untracked `universal-router/` tree as-is.

## Verification Status

Current working-tree validation:

- `bun g:format` passed.
- Focused web tests passed: token-list migration, Explore stats, token logo cell, and liquidity chart utilities.
- Focused `uniswap:test` passed: currency-info logo preference and token selector hooks.
- `bunx nx run gnosis-analytics-adapter:typecheck` passed.
- `bun g:lint:fix` passed with existing warnings only.
- `bun g:typecheck` passed.
- `bunx nx run-many -t test --exclude=web --exclude=uniswap` passed.
- `bun g:test` was attempted, but the aggregate run stopped emitting output for several minutes and was interrupted. Treat full aggregate completion as the remaining verification gap.
