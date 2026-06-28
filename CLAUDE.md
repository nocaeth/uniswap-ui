# CLAUDE.md

Fork of the Uniswap interface, retargeted to **Gnosis Chain (100) only**. Uniswap's
V3 contracts are deployed on Gnosis but Uniswap never shipped a UI there, and its
centralized backend (analytics Data API, swap-routing Trading API, prices) doesn't
serve Gnosis — so those pieces are replaced with self-hosted infra under `gnosis/`.

See `gnosis/README.md` (app-level changes + infra overview) and
`gnosis/adapter/README.md` (analytics service) before touching Gnosis-specific code.

## Toolchain

- **Bun** is the runtime/package manager (`>=1.3.11`); Node `22.22.2`. Never use npm
  (`engines.npm = please-use-bun`). Respect the existing lockfile.
- **Nx** monorepo. Workspaces: `apps/*`, `packages/*`, `config/*`, `tools/uniswap-nx`, `labs/*`.
- The web app is `apps/web`; most shared logic is `packages/uniswap`.

## Commands

Run from repo root. `g:` scripts fan out across the workspace via Nx.

| Task | Command |
|------|---------|
| Web dev server | `bun start` (= `nx start web`) |
| Format / lint / typecheck | `bun g:format` · `bun g:lint:fix` · `bun g:typecheck` |
| Test (all) | `bun g:test` — heavy; prefer scoping a project + file for local iteration |
| Test (scoped) | `bunx nx run web:test -- <path> --run --reporter=basic` (or `uniswap:test`) |
| Affected only | `bun g:check:fast` (typecheck + format + fast lint on uncommitted) |

`bun g:test` is slow/CPU-heavy in CI-like envs; scope tests to the specific project +
files you changed while iterating. As of 2026-06-28, `web:test` is sharded into four
sequential Vitest buckets in `apps/web/project.json` and should terminate instead of
spinning indefinitely.

### 2026-06-28 Web Test Hang

We hit repeated "tests run forever" behavior while working on PR 17. The root cause was
not overall test count alone:

- `web:test` previously ran one huge `vitest run`, which let jsdom-heavy tests pile up
  enough memory/worker churn that the process could spin after assertions completed.
- `apps/web/src/components/BreadcrumbNav/index.test.tsx` used `userEvent.hover/unhover`
  for a simple hover assertion; replacing that with `fireEvent.mouseEnter/mouseLeave`
  made the component shard exit cleanly.
- `apps/web/src/pages/TokenDetails/context/TDPStoreContextProvider.test.tsx` mounted the
  full provider/router path to test a deterministic Zustand sync routine. That coverage
  was moved to a pure `syncTDPStoreState` unit test.
- `apps/web/src/pages/PoolDetails/index.test.tsx` imported/rendered the full pool details
  page just to test not-found routing. The redirect decision now lives in
  `apps/web/src/pages/PoolDetails/redirect.ts` with a pure unit test.
- `apps/web/vitest.config.ts` uses the default reporter instead of `verbose` to reduce
  output volume and per-test overhead.

Validated after the fix:

- `bunx nx run web:test --skip-nx-cache`
- `bun g:format`
- `bun g:lint:fix` (passes with existing warning noise)
- `bun g:typecheck`
- `bun g:test`

## Gnosis-specific seams

- **Chain config** — `UniverseChainId.Gnosis = 100`; `getEnabledChains`/`getDefaultChainId`
  return only Gnosis (`packages/uniswap/src/features/chains/utils.ts`). V4 off, routing is V3-only.
- **Contract addresses** — added to `@uniswap/sdk-core` via `patches/@uniswap%2Fsdk-core@*.patch`.
- **Swap routing** — Trading API won't quote Gnosis, so swaps route client-side via QuoterV2 +
  UniversalRouter at the DI seams in `packages/uniswap/src/features/transactions/swap/services/gnosisRouter/`.
- **Token universe / logos** — Gnosis fallback list is `packages/uniswap/src/features/tokens/gnosisTokenList.ts`
  (seeds `COMMON_BASES`, `getCommonBase`, and local logo overrides), seeded from the
  nocaeth/gc-tokenlist canonical list. EURe/GBPe canonical addresses live in `gnosisCanonicalTokens.ts`.
- **Backend** — `gnosis/adapter/` re-implements Uniswap's Data API (ConnectRPC) + GraphQL on a
  local SQLite store backfilled from Gnosis via Envio HyperSync. Runs on Bun only (`bun:sqlite`).
  The app points at it via `API_BASE_URL_V2_OVERRIDE` / `GRAPHQL_URL_OVERRIDE` (see `gnosis/.env.gnosis.example`).
  Run: `bun run backfill` then `bun run sync` / `bun start` in `gnosis/adapter/`.
- **Public Uniswap links** are disabled for this deployment (`packages/uniswap/src/constants/urls.ts`);
  remaining `*.uniswap.org` references are backend deps, generated schemas, or env defaults.

## Conventions

- Other chains' definitions are kept in-tree but never selectable — don't delete them; gate behavior on chain config.
- `tools/uniswap-nx` is a committed stub (the seed checkout lacked the real package); replace if the real one becomes available.
- Match upstream Uniswap style in shared `packages/*` code; keep Gnosis changes at injection seams rather than forking shared components.
