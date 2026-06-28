# Ship-Lean Review: Gnosis-Only NOCA UI

Generated: 2026-06-28T12:34:37Z
Revision scanned: `3eb74a38f`

Method notes:

- Ran `ship-lean/scripts/scan.sh /Users/dave/projects/uniswap-ui`.
- The scan included local noise from untracked `universal-router/` and `.nx/cache`; findings below ignore those paths.
- Workflow fan-out was not launched because the available sub-agent tool policy requires an explicit user request for delegation. This report is based on the deterministic scan plus direct code verification.

## Bottom Line

The app is now much closer to the target: web-only, Gnosis-only at runtime, with swap, Explore, and LP flows as the product surface. The highest-value next cut is to remove the remaining non-Gnosis public/runtime surface: CSP/RPC allowlists, sitemap generation, Solana redirect glue, and unreachable Buy/Limit swap directories.

Do not simplify the Gnosis swap or LP calldata paths for leanness. They are funds-moving code; keep them conservative and add tests when touching them.

## Stakes Map

- **HIGH:** `packages/uniswap/src/features/transactions`, `packages/uniswap/src/data/apiClients/liquidityService`, `apps/web/src/features/Liquidity`, `apps/web/src/pages/CreatePosition`, `apps/web/src/pages/Positions`, `apps/web/src/pages/IncreaseLiquidity`, `apps/web/src/pages/RemoveLiquidity`, `apps/web/src/pages/AddLiquidity`, `apps/web/src/pages/PoolDetails`, `gnosis/adapter`, `gnosis/contracts`, `apps/web/src/connection`, `packages/chains`, `packages/sessions`.
  These can affect quotes, approvals, transaction calldata, wallet connections, pool state, or LP decisions.
- **LOW:** `README.md`, `RELEASE`, static metadata, SEO functions, snapshots, sitemap scripts, nav/help/link surfaces, disabled feature branches, CSP cleanup, tests/fixtures for deleted UI.
  These are reversible and do not directly sign or broadcast transactions.
- **LOW unless proven otherwise:** shared multichain registries under `packages/uniswap/src/features/chains`.
  Runtime selection is already Gnosis-only, but the registry still carries the upstream universe for compatibility.

## Findings

### 1. OVER-BUILT · `apps/web/public/csp.json:31`

The CSP still allows many non-Gnosis RPCs and product hosts even though the app is intended to be Gnosis-only. Examples include Arbitrum/Base/Optimism/BSC/Avalanche/Polygon/Scroll/Linea/Zora/Unichain RPCs and broad `*.uniswap.org` / `wss *.uniswap.org` access at `apps/web/public/csp.json:35` through `apps/web/public/csp.json:123`.

**Move:** prune `connectSrc` to self, the actual Gnosis RPCs, the self-hosted adapter/API origins, WalletConnect, Safe if required, and specific backend Uniswap API hosts still intentionally used.
**Effort:** ~1-2h, fully reversible.
**Stakes:** LOW.

### 2. OVER-BUILT · `packages/uniswap/src/features/chains/chainInfo.ts:1`

Runtime chain selection is Gnosis-only: `getEnabledChains` hard-filters to `UniverseChainId.Gnosis` at `packages/uniswap/src/features/chains/utils.ts:260`. But the shared registry still imports and exports every EVM chain plus Solana at `packages/uniswap/src/features/chains/chainInfo.ts:1` through `packages/uniswap/src/features/chains/chainInfo.ts:58`, and web Wagmi still configures `ORDERED_EVM_CHAINS` at `apps/web/src/connection/wagmiConfig.ts:125` through `apps/web/src/connection/wagmiConfig.ts:130`.

**Move:** first change web Wagmi to a Gnosis-only chain tuple. Leave the wider shared registry until callsites stop depending on exhaustive enum maps.
**Effort:** ~0.5 day for the web config, 1-2 days if deleting shared chain files.
**Stakes:** LOW for web config; treat shared registry deletion as ship-later because the compatibility blast radius is larger than the immediate benefit.

### 3. DELETE · `apps/web/scripts/generate-sitemap.js:24`

Sitemap generation is still all-network. It queries `topV2Pairs` on Ethereum at `apps/web/scripts/generate-sitemap.js:30`, requests token rankings for `ALL_NETWORKS` at `apps/web/scripts/generate-sitemap.js:67`, and loops through fourteen non-Gnosis chains at `apps/web/scripts/generate-sitemap.js:36` through `apps/web/scripts/generate-sitemap.js:51`.

**Move:** delete the script if static sitemaps are no longer part of launch, or constrain it to Gnosis-only token/pool URLs from the adapter.
**Effort:** ~1h, fully reversible.
**Stakes:** LOW.

### 4. DELETE · `apps/web/src/pages/Swap/index.tsx:181`

The active swap UI exposes only `SwapTab.Swap` at `apps/web/src/pages/Swap/index.tsx:181` through `apps/web/src/pages/Swap/index.tsx:190`, but the repo still carries 77 files under `apps/web/src/pages/Swap/Buy` and `apps/web/src/pages/Swap/Limit`. Those flows are not part of a Gnosis-only swap/LP/analytics app.

**Move:** delete `Swap/Buy` and `Swap/Limit`, then remove residual imports/tests/modals that only support those tabs. Keep shared components only if LP still imports them.
**Effort:** ~0.5-1 day because tests and a few shared helpers need cleanup.
**Stakes:** LOW.

### 5. DELETE · `apps/web/src/pages/RouteDefinitions.tsx:127`

There is still Solana-specific routing in the main router: the WSOL redirect imports `WRAPPED_SOL_ADDRESS_SOLANA` at `apps/web/src/pages/RouteDefinitions.tsx:4` and adds a `/explore/tokens/solana/...` route at `apps/web/src/pages/RouteDefinitions.tsx:127` through `apps/web/src/pages/RouteDefinitions.tsx:133`. `getDefaultChainId` also still has an SVM branch at `packages/uniswap/src/features/chains/utils.ts:301` through `packages/uniswap/src/features/chains/utils.ts:303`.

**Move:** delete the Solana redirect and remove the SVM default branch once no live Gnosis-only UI can request `Platform.SVM`.
**Effort:** ~30m, fully reversible.
**Stakes:** LOW.

### 6. SHIP LATER · `packages/uniswap/src/constants/urls.ts:22`

Public Uniswap links are disabled, which satisfies the current product requirement. But the constants file still carries a large upstream shape of help articles, mobile download URLs, governance/social links, wallet feedback links, and app routes at `packages/uniswap/src/constants/urls.ts:22` through `packages/uniswap/src/constants/urls.ts:153`.

**Move:** leave this for now unless you are already editing its callsites. Later, replace it with a small `NocaUrls` shape instead of a giant object of empty strings.
**Effort:** ~1-2 days if done properly across shared package callsites.
**Stakes:** LOW. Strip later; it is more work to remove safely than to leave blank today.

## Fine, Stop Worrying

### FINE · `gnosis/adapter/src/graphql.ts:350`

Liquidity/depth data now lives behind the backend adapter path. `V3Pool.ticks` enumerates backend/on-chain ticks and returns real tick prices at `gnosis/adapter/src/graphql.ts:350` through `gnosis/adapter/src/graphql.ts:364`, and the pool detail chart expects backend tick/pool-state fetching at `apps/web/src/pages/PoolDetails/components/ChartSection/index.tsx:169`.

**Move:** leave the backend-backed chart path. Add focused adapter/chart tests when behavior changes.
**Stakes:** HIGH.

### FINE · `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:30`

Gnosis LP create/increase/decrease/collect and approval construction is high-stakes. The file explicitly mirrors hosted LiquidityService shapes while building Gnosis V3 calldata from live chain state at `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:30` through `packages/uniswap/src/data/apiClients/liquidityService/gnosis/buildGnosisLiquidityCalldata.ts:38`.

**Move:** do not simplify this for leanness. Keep it explicit and test-heavy.
**Stakes:** HIGH.

### FINE · `packages/uniswap/src/features/chains/utils.ts:260`

The app-level runtime chain filter is already doing the right thing: only Gnosis is user-selectable. The remaining chain registry cleanup is repo hygiene, not launch-blocking behavior.

**Move:** leave shared multichain compatibility until the smaller web-only cuts above are done.
**Stakes:** LOW.
