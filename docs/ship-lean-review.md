# Ship-Lean Review: Gnosis-Only Scope

Generated: 2026-06-28T17:09:04Z
Base commit: `9de1babcd`

Scope: this review assumes the product should remain a Gnosis-only web app. Anything outside that goal is a deletion candidate unless removing it is more work, more risk, or more bundle churn than leaving it inert.

Method notes:

- Read the repo overview, root scripts, Gnosis compose stack, recent git history, ship-lean rubric, and current diff.
- Ran the ship-lean scanner on a temporary copy that excluded `.git`, `.nx`, `node_modules`, build outputs, vendored contract libs, and the unrelated untracked `universal-router/` checkout.
- The scanner flagged transaction/signing/approval paths, Gnosis contracts, the Gnosis quote builder, liquidity calldata, oversized adapter files, and inherited UniswapX/Solana surfaces. Findings below are verified against source lines.
- The skill's Workflow runner is not exposed in this environment, and the available delegation tool requires an explicit user request for sub-agents, so this report is a direct verified pass.

## Bottom Line

This branch is directionally right for a Gnosis-only app: the funds-moving Gnosis swap/liquidity paths are now where they belong, while visible non-Gnosis product surface has been trimmed. The highest-value next action is to stop pruning transaction code and instead either backfill missing backend chart data or hide the affected charts until the backend can serve them.

## Stakes Map

High-stakes: Gnosis contracts, swap quote construction, approvals, permits, Safe/EIP-5792 batching, Universal Router calls, transaction sagas, signing/broadcast paths, and Gnosis liquidity calldata. A mistake here can move value incorrectly.

Medium-stakes: Gnosis adapter data, URL/service configuration, token/pool metadata, pool/position pages, liquidity charts, and token-list fallbacks. These shape what the Gnosis-only product exposes and whether the UI is trustworthy.

Low-stakes: public help/static links, docs, labels, unreachable UniswapX/Solana UI, generated schemas, tests, and dormant product surfaces. Cut or hide these aggressively when they render or slow changes.

## Findings

### 1. 🟩 FINE · `packages/uniswap/src/data/apiClients/liquidityService/liquidityQueries.ts:59`

Gnosis liquidity is implemented behind the existing liquidity-service query boundary: pool info, LP approval checks, create, decrease, increase, and list-pools dispatch to Gnosis-specific builders at `liquidityQueries.ts:59`, `:78`, `:180`, `:199`, `:218`, and `:256`. The actual Gnosis builder explains the backend gap and constructs pool state, approvals, and NPM transactions at `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:30`.

The move: leave it and harden with focused liquidity tests when changing it. This is high-stakes transaction construction, not a lean-deletion target. Effort: none now. Reversibility: high-risk without equivalent backend behavior. [HIGH]

### 2. 🟩 FINE · `packages/uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote.ts:1`

The scanner correctly flags `fetchGnosisQuote.ts` as oversized at 1,838 LOC, but it is also the Gnosis funds-moving quote path. It discovers pools, evaluates sDAI/aggregation fallbacks, expands route hop tiers, resolves split legs, rejects bad price impact, and builds Permit2 approval transactions at `fetchGnosisQuote.ts:1521`, `:1541`, `:1611`, `:1664`, and `:1676`.

The move: do not split or delete this in a lean cleanup. Any simplification belongs in a hardening pass with swap-route, exact-output, approval, and split-fill tests. Effort: not a quick cleanup. Reversibility: high-risk. [HIGH]

### 3. 🟧 OVER-BUILT · `apps/web/src/features/Liquidity/hooks/usePoolTickData.ts:50`

The pool/position liquidity charts still assume indexed tick pages are available from GraphQL (`useAllV3TicksQuery` / `useAllV4TicksQuery` at `usePoolTickData.ts:50` and `:61`). If Gnosis tick data is missing, the hook returns no chart data at `usePoolTickData.ts:247`, so the UI can look broken even though live pool state is available elsewhere.

The move: either add backend tick distribution to the Gnosis adapter or hide the liquidity-depth chart tabs when the tick index is empty. Do not fake a histogram from current pool liquidity. Effort: ~1 day to hide cleanly, more to index ticks. Reversibility: easy for hiding, medium for backend indexing. [MEDIUM]

### 4. 🟧 OVER-BUILT · `gnosis/adapter/src/sync.ts:1`

The Gnosis adapter is right-sized operationally, but three read-heavy files are now bottlenecks: `sync.ts` is 1,035 LOC, `backfill.ts` is 966 LOC, and `dataApiService.ts` is 920 LOC. `sync.ts` mixes HyperSync transport, event parsing, token/pool accounting, rollup refresh, and retry behavior starting at `sync.ts:15`; `dataApiService.ts` mixes ConnectRPC service shape, on-chain position reads, ABI definitions, and portfolio shaping starting at `dataApiService.ts:43`.

The move: ship as-is for this PR, then split transport, decoding, rollup math, and service mapping into small modules after behavior stabilizes. Effort: 1-2 days. Reversibility: medium. [MEDIUM]

### 5. 🟨 SPECULATIVE · `apps/web/src/state/routing/types.ts:1`

Inherited UniswapX/off-chain order state remains in the web routing model: the file imports UniswapX SDK types at `routing/types.ts:7` and exposes `RouterPreference.X` at `routing/types.ts:50`. The signing callback still builds UniswapX order variants and fetches nonces from the gateway at `apps/web/src/hooks/useUniswapXSwapCallback.ts:60`.

The move: do not delete these while they are entangled with shared swap types. First prove the Gnosis production graph cannot reach them, then remove whole branches with swap tests. Effort: medium/high. Reversibility: high-risk if done casually. [LOW until reachable, HIGH if reachable]

### 6. 🟨 SPECULATIVE · `apps/web/src/features/wallet/connection/connectors/solana.ts:1`

Solana/SVM wallet support still exists in the web tree even though this app is Gnosis-only. The connector builds a `Platform.SVM` connection service at `solana.ts:52`, which is out of scope unless another route still exposes Solana wallets.

The move: leave it inert unless bundle analysis or UI testing proves it renders. Removing Solana safely crosses wallet, token, receive, and swap modules, so it is more work than carrying dormant code today. Effort: multi-day if done safely. Reversibility: medium. [LOW]

### 7. 🟩 FINE · `packages/uniswap/src/constants/urls.ts:22`

Public Uniswap outbound links are centrally blanked with `DISABLED_PUBLIC_LINK` at `urls.ts:22`; help article URLs and static docs/social links inherit that from `urls.ts:24` through `:120`. The web app URL now resolves to `swap.gno.now` at `urls.ts:12` through `:14`.

The move: keep public links disabled. Remaining `*.uniswap.org` URLs in API clients, env files, generated schemas, tests, and worker proxies are backend dependencies or fixtures, not user-facing links. Replace them only when NOCA owns equivalent services. Effort: none now. Reversibility: easy for public links, expensive for backend hosts. [LOW/MEDIUM]

### 8. 🟩 FINE · `packages/uniswap/src/features/tokens/gnosisTokenList.ts:16`

The token-list direction is correct for Gnosis-only: the default inactive token list points at NOCA's Gnosis list (`apps/web/src/constants/lists.ts:1`), and the static fallback includes Gnosis-native logo assets plus GBPe at `gnosisTokenList.ts:16`, `:19`, and `:86`.

The move: keep this local fallback even if backend metadata improves. It is cheap, reversible, and protects token search/logos from upstream index lag. Effort: none. Reversibility: easy. [MEDIUM]

## Next Lean Cuts

Recommended:

- Hide or backend-fill charts that need tick distribution before spending more time polishing chart UI.
- Use the Nx graph and a web bundle check before deleting Solana/SVM or UniswapX internals.
- Keep deleting unsupported product surfaces whole, as with Buy/Limit, instead of leaving hidden buttons.

Avoid for now:

- Do not simplify approval, permit, Safe batching, router, swap callback, or liquidity calldata code without focused transaction tests.
- Do not delete shared packages by name alone; first prove they are unused in the web production graph.
- Do not stage the untracked `universal-router/` tree.
