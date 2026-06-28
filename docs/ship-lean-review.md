# Ship-Lean Review: Gnosis-Only Scope

Generated: 2026-06-28 15:53:26 UTC
Base commit: `cd6609672`

Scope: this review assumes the product should remain a Gnosis-only web app. Anything not serving that goal is a deletion candidate unless removing it is riskier or more expensive than carrying it.

Method notes:

- Read the repo overview, package scripts, Gnosis compose file, recent git history, and the ship-lean rubric.
- Ran the ship-lean scanner. It completed, but the raw output is noisy because `.nx/cache`, vendored contract trees, and the untracked `universal-router/` checkout dominate file-size/high-stakes lists.
- Verified findings with targeted `rg` scans and line-numbered source reads.
- Did not spawn sub-agents because the available delegation tool is restricted to explicit user requests for parallel agents.

## Bottom Line

The PR is much closer to a shippable Gnosis-only app: swap, liquidity, token/logo, sitemap, CSP, and route cleanup are now scoped around Gnosis, and the orphaned Limit order UI has been deleted instead of merely hidden.

The highest-value remaining lean cut is still product-surface cleanup, not shared-package refactoring: remove the unreachable Buy/off-ramp and Solana wallet surfaces next, then decide whether broad non-Gnosis bridge/chain metadata is worth stripping.

## Stakes Map

High-stakes:

- Swap execution, approvals, permits, Safe/EIP-5792 batching, Universal Router calls, transaction sagas, and any code that signs or broadcasts.
- Gnosis liquidity calldata builders and adapter endpoints when they feed position creation, increase, decrease, collect, or approval flows.
- `gnosis/contracts/` and any tracked router deployment source.

Medium-stakes:

- Explore pool data, token metadata/logo resolution, token/pool detail pages, position pages, and liquidity charts.
- URL/service configuration and chain enablement logic that defines the Gnosis-only app boundary.

Low-stakes:

- Disabled help-link callsites, docs, route redirects, SEO scripts, comments, unused static assets, and unreachable product UI source.

## Findings

### 1. FINE: Do Not Lean Down Funds-Moving Code In This PR

`apps/web/src/features/Swap/hooks/useSendCallback.ts`, `apps/web/src/hooks/usePermitAllowance.ts`, `apps/web/src/hooks/useUniversalRouter.ts`, `packages/uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote.ts:1`, and `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:30` remain high-stakes because they touch approvals, permits, routing, calldata, or broadcast.

The ship-lean move: leave them in this PR. Any simplification here should be a hardening pass with transaction-focused tests, not a scope-pruning pass. [HIGH]

### 2. FINE: Backend Liquidity Ownership Is Correct

`gnosis/adapter/src/onchain.ts:64` enumerates initialized V3 bitmap words, `gnosis/adapter/src/onchain.ts:92` reads tick data in chunks, and `gnosis/adapter/src/onchain.ts:143` caches tick reads briefly. `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:216` resolves Gnosis pool info from on-chain state, while `:385`, `:450`, and `:486` build create/increase/decrease transactions through the same response shapes as the existing liquidity pipeline.

This is the right ownership boundary: browser UI consumes liquidity and calldata responses; it does not reinvent tick enumeration or hosted-service gaps in page components.

The ship-lean move: ship it; add metrics/cache tuning only if RPC cost becomes visible. [HIGH]

### 3. FINE: Active Public Link Surface Is Mostly Blank

`packages/uniswap/src/constants/urls.ts:22` centralizes disabled public links, and the static map now blanks help/docs/social/download links plus unrelated Unichain/Wormhole public URLs. A source scan still finds Uniswap domains in API service endpoints, Datadog filtering, and tests; those are not user-facing links.

The ship-lean move: keep API endpoints separate from public links. Replace endpoint hosts only when the corresponding service is actually owned by NOCA. [LOW]

### 4. FINE: Route Surface Is Now Gnosis-Oriented

`apps/web/src/pages/RouteDefinitions.tsx:157` mounts `/swap`, and `apps/web/src/pages/RouteDefinitions.tsx:161` through `:240` keep only current V3 position/liquidity routes plus legacy V3 redirects. Unsupported Solana WSOL, V2, and V4 liquidity routes were removed earlier in this branch.

The ship-lean move: ship it; remove deeper shared V2/V4 helpers only with Nx graph evidence. [LOW]

### 5. FINE: Limit UI Was Deleted, Not Hidden

`apps/web/src/pages/Swap/index.tsx:181` restricts the swap surface to the Swap tab. The source scan now has no matches for `apps/web/src/pages/Swap/Limit`, `LimitPriceInputPanel`, `LimitOrderPreview`, `LimitOrderDetails`, `useLimitOrderCallback`, or `expiryToDeadlineSeconds`. `apps/web/src/components/SearchModal/CurrencySearch.tsx` no longer special-cases `TokenSelectorFlow.Limit`, and `apps/web/src/test-utils/constants.ts` no longer imports limit UI helpers just to build test fixtures.

The ship-lean move: ship it. This was dead Gnosis-only weight and was cheap to delete. [LOW]

### 6. FINE: Deep Links Now Document Gnosis Only

`apps/web/src/features/deepLinking/README.md:13` documents `/swap` with `chain=gnosis`, `:32` says buy/sell/limit/send routes are intentionally unmounted, and token/pool examples now use `gnosis` paths only. The old multi-chain and mobile-app marketing language is gone.

The ship-lean move: ship it. [LOW]

### 7. SPECULATIVE: Buy/Off-Ramp Source Still Exists

`apps/web/src/pages/Swap/Buy/ProviderOption.tsx:79` still builds a `/sell` redirect URL, and `apps/web/src/pages/Swap/Buy/` remains in source even though the route/tab is not mounted. Some receive/off-ramp utilities may still share this code, so delete it only after a focused import graph check.

The ship-lean move: prove reachability, then delete whole unsupported surfaces rather than hiding buttons. [LOW]

### 8. SPECULATIVE: Shared Non-Gnosis Bridge And Chain Metadata Remain

`packages/uniswap/src/features/bridging/constants.ts:8` through `:34` still list many external bridge URLs, and non-Gnosis chain info files still carry bridge/docs/RPC metadata. These are broad shared-package constants, not current route blockers, and removing them file-by-file is more churn than the value in this PR.

The ship-lean move: defer. If the app stays permanently Gnosis-only, make a dedicated chain-metadata pruning PR with bundle-size and Nx graph checks. [LOW]

### 9. SPECULATIVE: Keep `universal-router/` Out Of This PR

The untracked `universal-router/` checkout is huge and includes vendored contracts, caches, tests, and deployment artifacts. It dominated the scanner output. If router source needs to live in this repo, track only minimal deployment source/artifacts under a deliberate path or submodule.

The ship-lean move: do not stage it. [HIGH if tracked]

## Next Lean Cuts

Recommended:

- Delete Buy/off-ramp source after confirming no receive/on-ramp path still imports it.
- Prune Solana wallet prompts/connectors only after confirming shared wallet UI does not still require them for tests.
- Decide whether non-Gnosis chain metadata should stay as inert shared-package ballast or be removed in a dedicated bundle-size PR.

Avoid for now:

- Do not simplify approval, permit, Safe batching, router, swap callback, or liquidity calldata code without focused transaction tests.
- Do not delete shared packages by name alone; first prove they are unused in the Nx graph and production bundle.
- Do not stage the untracked `universal-router/` tree as-is.

## Verification Status

Current working-tree validation:

- `bun g:format` passed.
- `bun g:typecheck` passed.
- Focused web tests passed: `bunx nx run web:test -- src/pages/routes.test.ts src/pages/paths.test.ts src/features/Swap/state/SwapContext.test.tsx src/test-utils/constants.test.ts src/state/routing/types.test.ts --run --reporter=basic` (5 files, 31 tests).
- `bun g:lint:fix` passed with existing warnings only.
- `git diff --check` passed.
- Source scan passed for removed Limit UI imports.
- Public Uniswap-domain scan now finds service/test endpoints only, not active help/static links.
- `bun g:test` was attempted again after the Limit deletion. It ran for more than seven minutes and left an orphaned Vitest worker consuming CPU after compaction removed the output stream, so it was interrupted and remains the broad-suite verification gap.
