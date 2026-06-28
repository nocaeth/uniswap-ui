# Ship-Lean Review: Gnosis-Only Scope

Generated: 2026-06-28T16:35:19Z
Base commit: `b5fbcf6a2`

Scope: this review assumes the product should remain a Gnosis-only web app. Anything outside that goal is a deletion candidate unless removing it is more work, more risk, or more bundle churn than leaving it inert.

Method notes:

- Read the repo overview, package scripts, Gnosis compose file, recent git history, ship-lean rubric, and current diff.
- Ran the ship-lean scanner. It emitted the high-stakes detector output, then became dominated by the untracked `universal-router/` checkout and vendored contract trees, so it was interrupted rather than letting an unrelated local tree drive the report.
- Verified findings with targeted source scans and cited files below.
- Did not spawn sub-agents because the available delegation tool is restricted to explicit user requests for parallel agents.

## Bottom Line

The current PR removes the right kind of code for a Gnosis-only app: dead buy/off-ramp source, visible Uniswap-branded wallet/provider affordances, stale route/test constants, and public help/static links. The highest-value next action is restraint: leave funds-moving Gnosis swap/liquidity code alone, and only prune remaining non-Gnosis shared UI when it is visibly reachable or measurably large in the web bundle.

## Stakes Map

High-stakes: swap quote construction, approvals, permits, Safe/EIP-5792 batching, Universal Router calls, transaction sagas, signing/broadcast paths, Gnosis router code, and Gnosis liquidity calldata builders. A mistake here can move value incorrectly.

Medium-stakes: route definitions, chain enablement, token/pool metadata, pool/position pages, liquidity charts, and URL/service configuration. These define what the Gnosis-only product exposes.

Low-stakes: help/static links, docs, i18n copy, test IDs, wallet modal labels, receive-provider presentation, deleted buy/off-ramp UI, and other unreachable product surfaces. Cut these aggressively.

## Findings

### 1. 🟩 FINE · `packages/uniswap/src/data/apiClients/liquidityService/liquidityQueries.ts:59`

Gnosis liquidity now dispatches through the liquidity-service client boundary instead of page components. The Gnosis-specific implementation handles pool info, create, increase, decrease, claim, and approvals at `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:216`, `:385`, `:450`, `:486`, `:529`, and `:551`.

The move: leave it. This is high-stakes transaction construction, so future changes should be hardening/test work, not lean deletion. Effort: none. Reversibility: do not revert without replacing the backend behavior. [HIGH]

### 2. 🟩 FINE · `packages/uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo.ts:65`

Gnosis swap approvals are intentionally separated from the Trading API path: `useTokenApprovalInfo.ts:136` skips the hosted approval query for Gnosis, and `classicSwapTxAndGasInfoService.ts:42` handles Gnosis approval batching. The router still has broad routing code, including `fetchGnosisQuote.ts:1277`, but that complexity is on a funds-moving path.

The move: leave it in this PR. If it needs simplification, do it as a hardening pass with transaction-focused tests. Effort: not a lean cleanup. Reversibility: high-risk. [HIGH]

### 3. 🟩 FINE · `packages/uniswap/src/features/providers/webForNudgeProvider.tsx:38`

The dead buy/off-ramp surface is now removed rather than hidden: `/swap` remains the mounted swap route at `apps/web/src/pages/RouteDefinitions.tsx:157`, the old `apps/web/src/pages/Swap/Buy/*` source is deleted in this diff, and the web fiat-on-ramp nudge now always returns false for the Gnosis-only app.

The move: ship it. This is exactly the kind of low-stakes deletion that makes the product easier to reason about. Effort: already done. Reversibility: fully reversible from git. [LOW]

### 4. 🟩 FINE · `packages/uniswap/src/constants/urls.ts:22`

Public outbound links are centralized and blanked: help/articles/download/social/docs links use `DISABLED_PUBLIC_LINK` from `urls.ts:25` through `:120`, and the now-unmounted buy URL is disabled at `urls.ts:148`. The remaining `UNISWAP_WEB_URL` constant resolves to `swap.gno.now` at `urls.ts:12` through `:14`, not `app.uniswap.org`.

The move: keep backend API endpoints separate from public links. Uniswap-hosted service URLs still exist for data, GraphQL, liquidity, and gateway calls; those are dependencies, not user-facing links. Effort: none unless NOCA replaces those services. Reversibility: easy for public links, expensive for backend hosts. [LOW/MEDIUM]

### 5. 🟩 FINE · `apps/web/src/components/WalletModal/WalletConnectorOption.tsx:40`

Visible Uniswap wallet branding has been neutralized in the wallet modal: the connector option uses a generic wallet icon, `WalletConnectorOption.tsx:73` displays the actual wallet name, `WalletBrandedIcon.tsx:24` uses `WalletFilled`, and the Coinbase wallet SDK logo points at `https://swap.gno.now/favicon.png` in `apps/web/src/connection/wagmiConfig.ts:89`.

The move: ship it. There is no reason to spend more time renaming every internal identifier in this PR as long as the rendered product is generic/NOCA-facing. Effort: already done. Reversibility: easy. [LOW]

### 6. 🟨 SPECULATIVE · `packages/uniswap/src/data/solanaConnection/getSolanaParsedTokenAccountsByOwnerQueryOptions.ts:1`

Solana/SVM support still exists in shared packages, and some web-visible utilities still account for it, for example `packages/uniswap/src/components/ReceiveQRCode/ReceiveQRCode.tsx:173` and `packages/uniswap/src/features/transactions/swap/form/SwapFormScreen/SwapFormScreenDetails/SwapFormScreenFooter/ExactOutputUnavailableWarningRow.tsx:44`.

The move: defer unless bundle analysis says it matters. Stripping this safely crosses data, wallet, token, and shared swap code; that is more work than carrying inert code today. Effort: multi-day if done safely. Reversibility: medium. [LOW until reachable]

### 7. 🟩 FINE · `packages/uniswap/src/features/transactions/swap/steps/uniswapxSteps.ts:13`

UniswapX internals are out of product scope for Gnosis, but the remaining code sits in shared transaction/signing paths. Files such as `uniswapxSteps.ts` and `packages/uniswap/src/features/transactions/swap/review/SwapReviewScreen/SwapErrorScreen.tsx:44` are high-stakes if reachable.

The move: do not lean-delete these inside this PR. First prove the Gnosis quote/routing path cannot reach them, then remove whole feature branches with focused swap tests. Effort: medium/high. Reversibility: high-risk without tests. [HIGH]

### 8. 🟨 SPECULATIVE · `universal-router/`

The untracked `universal-router/` checkout dominated the scanner output with vendored contracts, tests, and deployment files. It is not part of this PR and should not be staged.

The move: leave it untracked. If router source needs to live in this repository, add only the minimal deployment source or use a deliberate submodule/vendor strategy. Effort: low to keep out, high to curate. Reversibility: easy while untracked. [HIGH if tracked]

## Next Lean Cuts

Recommended:

- Use an Nx graph plus bundle-size check before deleting Solana/SVM shared code.
- Remove remaining visible UniswapX/Solana labels only where they can actually render in the Gnosis web app.
- Keep deleting unsupported product surfaces whole, as with Buy and Limit, instead of leaving hidden buttons.

Avoid for now:

- Do not simplify approval, permit, Safe batching, router, swap callback, or liquidity calldata code without focused transaction tests.
- Do not delete shared packages by name alone; first prove they are unused in the web production graph.
- Do not stage the untracked `universal-router/` tree.

## Verification Status

Current working-tree validation:

- `bun i18n:extract` passed after localized string changes.
- `bun g:format` passed.
- `bun g:typecheck` passed.
- Focused web tests passed: `bunx nx run web:test -- src/components/WalletModal/WalletModals.test.tsx src/pages/routes.test.ts src/pages/paths.test.ts src/hooks/useIsPage.test.tsx --run --reporter=basic` (4 files, 34 tests).
- Focused package tests passed: `bunx nx run uniswap:test -- src/features/transactions/swap/components/SwapFormButton/hooks/useSwapFormButtonHooks.test.ts src/utils/routingDiagram/routingProviders/uniswapRoutingProvider.test.ts --run --reporter=basic` (2 files, 55 tests).
- `bun g:lint:fix` completed with existing warnings only.
- `git diff --check` passed.
- Broad `bun g:test` and full web test runs were attempted but did not emit final summaries after several minutes of silence and were interrupted; focused tests and typecheck are the completed verification for this PR.
