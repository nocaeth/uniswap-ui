# Ship-Lean Review: Gnosis-Only Scope

Generated: 2026-06-28 15:30:15 UTC
Base commit: `905e8f46a`

Scope: this review assumes the product should remain a Gnosis-only web app. Anything not serving that goal is a candidate for removal, unless removing it is riskier or more expensive than carrying it.

Method notes:

- Read the repo overview, package scripts, Gnosis compose file, recent git history, and the ship-lean rubric.
- Ran the ship-lean scan; it produced useful high-stakes and file-size sections, then was stopped because it was still walking vendored and untracked router trees.
- Verified the findings below with targeted `rg` and line-numbered source reads.
- Did not spawn sub-agents because the available delegation tool is restricted to explicit user requests for parallel agents.

## Bottom Line

This PR is now scoped correctly for a Gnosis-only launch: liquidity tick enumeration lives in the backend adapter, Explore pools are V3-only, token logos prefer the NOCA Gnosis token list, legacy fallback token lists point at the NOCA list, active sitemap generation is Gnosis-only, CSP no longer grants obvious non-Gnosis product/network hosts, unsupported V2/V4/Solana route entries have been removed, and the unused wallet QR SVG has been deleted.

The highest-value next cuts are not package-wide refactors. Remove unreachable Buy/Limit/off-ramp and Solana wallet surfaces first; leave broad shared-package deletion for a separate cleanup with Nx graph evidence.

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

### 5. FINE: Runtime CSP Is Now Narrower For Gnosis

`apps/web/public/csp.json:31` no longer allows obvious non-Gnosis chain/product hosts such as Arbitrum, Base, Optimism, BNB, Polygon, Blast, Zora, Unichain, MoonPay, OpenSea, or legacy Uniswap websocket/API domains.

The file still carries shared wallet, analytics, token-list, and generic RPC providers because removing those safely requires runtime verification. That is acceptable for this PR: the broadest non-Gnosis deployment signals are gone without touching funds-moving code.

The ship-lean move: ship it; revisit only after route/product cleanup proves more hosts are unreachable. [LOW]

### 6. FINE: Sitemap Generation Is Gnosis-Only

`apps/web/scripts/generate-sitemap.js:24` defines Gnosis-only sitemap constants, `apps/web/scripts/generate-sitemap.js:88` fetches the NOCA token list, and `apps/web/scripts/generate-sitemap.js:115` writes token URLs only under `/explore/tokens/gnosis/`.

The script no longer calls Uniswap Explore gateway, Uniswap GraphQL, or all-network token rankings. Pool sitemap generation preserves existing Gnosis pool URLs rather than inventing external pool discovery in the frontend.

The ship-lean move: ship it; add backend pool sitemap data later only if SEO needs it. [LOW]

### 7. FINE: Unsupported V2/V4/Solana Routes Were Removed

`apps/web/src/pages/RouteDefinitions.tsx` no longer mounts the Solana WSOL redirect, V2/V4 position routes, V2 pool finder, V2 add-liquidity, or V2 remove-liquidity routes. `apps/web/src/pages/paths.ts` and the route snapshot were updated to match the supported route surface.

The generic V3 legacy redirects remain for compatibility (`/pool`, `/pool/:tokenId`, `/pools`, `/pools/:tokenId`, `/add`, `/remove/:tokenId`). Old V2-looking URLs fail closed instead of being misread as V3 token IDs.

The ship-lean move: ship it; remove deeper shared V2/V4 helpers only with Nx graph evidence. [LOW]

### 8. SPECULATIVE: Buy/Limit And Solana Wallet Surfaces Remain In Source

The visible swap tab is already Swap-only, but `apps/web/src/pages/Swap/Buy/` and `apps/web/src/pages/Swap/Limit/` remain in the tree, and wallet connection components still include Solana-specific prompts. They are dead weight for a Gnosis-only app unless a hidden route or test still imports them.

The ship-lean move: delete whole unsupported surfaces, not scattered help links. Do this after route cleanup so imports fail loudly. [LOW]

### 9. FINE: User-Facing Uniswap Links Are Disabled

`packages/uniswap/src/constants/urls.ts:24` centralizes public help links behind `DISABLED_PUBLIC_LINK`, and `packages/uniswap/src/constants/urls.ts:94` points web interface URLs at `https://swap.gno.now`. A source scan still finds legacy Uniswap domains in backend service hosts, generated schemas, comments, and tests; those are not active user-facing links.

The ship-lean move: leave blank help URLs until NOCA-owned docs exist. [LOW]

### 10. FINE: Dead QR Asset Was Deleted

`apps/web/src/components/WalletOneLinkQR.tsx` was a 3,125-line inline SVG with no imports outside its own export. It has been deleted in this branch.

The ship-lean move: ship it. [LOW]

### 11. SPECULATIVE: Keep `universal-router/` Out Of This PR

The untracked `universal-router/` checkout is huge and includes vendored contracts, caches, tests, and deployment artifacts. The scan shows it dominates high-stakes and file-size output. If router source needs to live in this repo, track only the minimal deployment source/artifacts under a deliberate path or submodule.

The ship-lean move: do not stage it. [HIGH if tracked]

## Next Lean Cuts

Recommended:

- Delete Buy/Limit/off-ramp and Solana wallet surfaces once route cleanup proves they are unreachable.
- Remove the Explore pools protocol column only after route/data cleanup proves there is no non-V3 table consumer.

Avoid for now:

- Do not simplify approval, permit, Safe batching, router, or swap callback code without focused transaction tests.
- Do not delete shared packages by name alone; first prove they are unused in the Nx graph and production bundle.
- Do not stage the untracked `universal-router/` tree as-is.

## Verification Status

Current working-tree validation:

- `bunx nx sitemap:generate web` passed and generated Gnosis-only sitemap outputs.
- Direct XML validation passed for `sitemap.xml`, `tokens-sitemap.xml`, and `pools-sitemap.xml`; the generated sitemaps parse, have trailing newlines, contain no Uniswap domains, and the token sitemap contains 24 Gnosis token URLs.
- `bun g:format` passed.
- `bun g:lint:fix` passed with existing warnings only.
- `bun g:typecheck` passed.
- `bunx nx run web:test -- src/pages/routes.test.ts src/pages/paths.test.ts src/pages/Positions/hooks/usePositionFilters.test.ts src/features/Liquidity/PositionsListSection.test.tsx src/features/Liquidity/PositionsHeader.test.tsx src/utils/urlRoutes.test.ts --run --reporter=basic` passed: 6 files, 57 tests.
- Focused web tests passed: `src/utils/validateTokenList.test.ts` and `src/state/migrations/9.test.ts`.
- Focused web tests passed: token-list migration, Explore stats, token logo cell, and liquidity chart utilities.
- Focused `uniswap:test` passed: currency-info logo preference and token selector hooks.
- `bunx nx run gnosis-analytics-adapter:typecheck` passed.
- `bunx nx run-many -t test --exclude=web --exclude=uniswap` passed.
- `bun g:test` was attempted after the route cleanup; many package suites reached visible pass output, then the aggregate process stopped emitting output for roughly 90 seconds and was interrupted. Earlier broad `web:test` and `web test:set1` attempts showed the same no-output hang after visible test output. Treat broad web/all aggregate completion as the remaining verification gap.
- `git diff --check` passed.
