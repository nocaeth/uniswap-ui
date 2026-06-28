# SdaiZapRouter — composable WXDAI/xDAI ↔ sDAI bridge for V3 routing

On Gnosis the deep stable/ETH v3 liquidity is centered on **sDAI** (sDAI/EURe = 166k/206k,
sDAI/wstETH = 624k), while **WXDAI's only direct v3 edge into that cluster is the shallow
WXDAI/USDC.e pool (~36k USDC.e)**. So a plain v3 swap of size *from* WXDAI suffers large price
impact (e.g. 50k WXDAI→USDC.e ≈ 36.3k out, ~27% impact).

WXDAI↔sDAI conversion via the Gnosis **Savings xDAI adapter** (`0xD499…`) is free and
unbounded, but the stock UniversalRouter can't call the vault mid-route. `SdaiZapRouter`
fuses the adapter conversion with a SwapRouter02 multi-hop in **one atomic transaction**:

| Entry point | Flow |
|---|---|
| `depositAndSwap` | WXDAI \| xDAI → (adapter) → sDAI → (v3 `path`) → tokenOut |
| `swapAndRedeem`  | tokenIn → (v3 `path`) → sDAI → (adapter) → WXDAI \| xDAI |

Measured on a live Gnosis fork: **50k WXDAI → 49,853.62 USDC.e** (vs 36,276.87 direct, **+37.4%**),
and the reverse 50k USDC.e → 49,816.92 WXDAI. Works for native xDAI in/out as well.

The contract holds no funds between calls: every call pulls, converts/swaps, forwards to
`recipient`, and leaves no dangling balances or approvals.

## Addresses wired in (Gnosis, chain 100)

| Role | Address |
|---|---|
| WXDAI (vault asset / WETH9) | `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` |
| sDAI (ERC-4626 vault) | `0xaf204776c7245bF4147c2612BF6e5972Ee483701` |
| Savings xDAI adapter | `0xD499b51fcFc66bd31248ef4b28d656d67E591A94` |
| SwapRouter02 | `0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be` |

## Build & test

```bash
# deps (gitignored; fetched on demand)
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
git clone --depth 1 --branch v5.1.0 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts

forge build
forge test --fork-url "$RPC_GNOSIS" -vv   # 8 fork tests: both directions, native, reverts
```

## Deploy

Verification uses the **Etherscan V2** API (one unified key across chains, `chainid` selected by
`--chain`). The old per-chain `https://api.gnosisscan.io/api` V1 endpoint is deprecated and will
fail — let Foundry's `etherscan` verifier use its default V2 endpoint (`https://api.etherscan.io/v2/api`)
and pass `--chain 100`. `ETHERSCAN_API_KEY` is a unified Etherscan key (not a gnosisscan-only key).

```bash
# one-time: encrypted keystore so the key isn't in shell history
cast wallet import gnosis-deployer --interactive

forge script script/DeploySdaiZap.s.sol:DeploySdaiZap \
  --rpc-url "$RPC_GNOSIS" --account gnosis-deployer --broadcast \
  --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
```

Record the deployed address.

## Wiring into the app (follow-up, not done here)

The contract is standalone and tested; the UI does **not** route through it yet. To use it
for WXDAI-bridged routes, `gnosisSwapRepository.ts` must, when the quote's route starts/ends
at WXDAI and bridges via sDAI:

1. Encode the V3 `path` from `quote.route` (packed `token|fee|token|…`), beginning **or**
   ending at sDAI (`0xaf20…`).
2. Build calldata to `SdaiZapRouter.depositAndSwap` (WXDAI/xDAI in) or `swapAndRedeem`
   (WXDAI/xDAI out) instead of the UniversalRouter calldata.
3. Approval: the user approves **WXDAI** (or `tokenIn`) to the zap via plain ERC20
   `approve` (SwapRouter02 path uses approvals, not Permit2). Native xDAI needs no approval.
4. Quoting: `fetchGnosisQuote` must additionally consider the `WXDAI→sDAI(adapter)→…` and
   `…→sDAI(adapter)→WXDAI` virtual edges so the deep sDAI cluster is priced for WXDAI.

Notes / limits:
- Single V3 path per call (no split-fill); the zap targets the deep single-path bridge.
  Split-fill across disjoint paths would need either repeated calls or a batched variant.
- `swapAndRedeem` enforces slippage on the final redeemed WXDAI/xDAI (the v3 leg runs with
  `amountOutMinimum = 0`); `depositAndSwap` enforces it on `tokenOut` via SwapRouter02.
- `path` must be a canonical V3 path (`token(20) + N×(fee(3)+token(20))`, i.e. length ≥ 43,
  `(length-20) % 23 == 0`) or the call reverts with `MalformedPath`.
- **Native-xDAI output (`swapAndRedeem` with `toNative=true`) requires a `recipient` that
  accepts a bare value transfer.** The adapter pushes xDAI via `recipient.call{value}` and
  reverts on failure, so a contract wallet without a payable receiver makes the whole call
  revert (atomic, no loss). Route contract recipients with `toNative=false` (WXDAI) instead.
- Standard ERC20s only: a fee-on-transfer / deflationary `tokenIn` makes `swapAndRedeem`
  revert; a FoT/hook `tokenOut` can under-deliver vs the pool-reported minimum in
  `depositAndSwap`. The intended sDAI/WXDAI/EURe/USDC.e/wstETH cluster is unaffected.
- Non-custodial: there is no rescue/sweep and no `receive`/`fallback`. Tokens or native
  mis-sent directly to the address are unrecoverable (by design; creates no theft vector).
