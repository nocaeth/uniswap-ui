# Gnosis contract deployments

Gnosis Chain (100) already has the full Uniswap **V3** stack deployed (factory,
SwapRouter02, QuoterV2, NonfungiblePositionManager, TickLens, V3Migrator,
Multicall, v3Staker). Two contracts the modern swap flow needs are **missing**
and must be deployed by us:

| Contract         | Status on Gnosis | Action |
|------------------|------------------|--------|
| Permit2          | not in the official list — verify on-chain | deploy at the **canonical** address |
| UniversalRouter  | not deployed     | deploy with the Gnosis params below |

> All other addresses are already baked into the app via the `@uniswap/sdk-core`
> patch — see `patches/@uniswap%2Fsdk-core@7.17.0.patch`.

## 0. Prerequisites

```bash
# Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup
# env
cp ../.env.gnosis.example .env && $EDITOR .env   # set DEPLOYER_PRIVATE_KEY, GNOSIS_RPC_URL
```

## 1. Permit2 (canonical, deterministic)

Permit2 is a singleton deployed via the deterministic CREATE2 deployer, so it has
the **same address on every chain**: `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
The `@uniswap/permit2-sdk` returns this address for chain 100 by default (verified),
so deploying here means **no SDK patch is needed** — but you must hit the canonical
address.

First check whether it already exists (many chains already have it):

```bash
cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url "$GNOSIS_RPC_URL"
# non-"0x" output => already deployed, skip to step 2.
```

If absent, deploy from the official repo (it uses the deterministic deployer):

```bash
gh repo clone Uniswap/permit2 && cd permit2
forge install
forge build
# Deploys to the canonical address via CREATE2 (salt 0):
forge script script/DeployPermit2.s.sol:DeployPermit2 \
  --rpc-url "$GNOSIS_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
```

Confirm the resulting address equals the canonical one. If it does not, the
deterministic deployer (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) is missing on
Gnosis — deploy that proxy first (Arachnid's deterministic-deployment-proxy).

## 2. UniversalRouter

UniversalRouter has **no canonical address**, so its address is chain-specific and
must be wired back into the app (step 3).

> **Version — match the SDK, not the newest UR.** The app encodes swaps with
> `@uniswap/universal-router-sdk@4.33.0`, which depends on **`@uniswap/universal-router@2.1.0`**.
> The deployed contract MUST be that exact version or the command/input ABI won't match.
> 2.1.0 is **not tagged** (the 2.x line lives on `main`), so pin the release commit
> **`67553d8b067249dd7841d9d1b0eb2997b19d4bf9`** (its `package.json` is `version: 2.1.0`;
> its `RouterParameters.sol` / `V3SwapRouter.sol` / `UniversalRouter.sol` / `Dispatcher.sol`
> are byte-identical to `node_modules/@uniswap/universal-router@2.1.0`, verified).
>
> **Why a redeploy (the bug this fixes).** The previous deploy used commit
> `cb222d3` ("UR 2.1.1"), which added a 6th field `uint256[] minHopPriceX36` to
> `V3_SWAP_EXACT_IN`. The SDK still encodes only **5** fields, so that router read word 5
> (the path length) as an array offset and reverted **`SliceOutOfBounds()` (`0x3b99b53d`)
> on every swap** — single- and multi-hop, batched or not. 2.1.0 is the 5-field version the
> SDK targets, so its decode matches. (cb222d3 also had an 11th param
> `permissionsAdapterFactory`; 2.1.0's struct is the **10 fields** in `DeployGnosis.s.sol`.)

```bash
gh repo clone Uniswap/universal-router && cd universal-router
git checkout 67553d8b067249dd7841d9d1b0eb2997b19d4bf9   # == @uniswap/universal-router@2.1.0
forge install                  # lib/ submodules (forge-std, v4-periphery, …)
yarn install --ignore-engines  # REQUIRED: node_modules/@uniswap/{v2-core,v3-core}
                               # Needs Node >= 18 (a Hardhat dev-dep, @nomicfoundation/edr,
                               # demands it). --ignore-engines skips that check on Node 16
                               # (edr is unused by forge build); or `fnm use 20` first.
                               # The v2/v3-core imports resolve from node_modules, not lib/.

# SAFETY CHECK — prove the checkout matches the SDK's contract before building:
test -z "$(grep -rl minHopPrice contracts/)" && echo "OK: 5-field (matches SDK)" || echo "STOP: 6-field, wrong commit"
diff contracts/types/RouterParameters.sol \
  /path/to/this-repo/node_modules/@uniswap/universal-router/contracts/types/RouterParameters.sol \
  && echo "OK: RouterParameters identical to node_modules 2.1.0"

cp /path/to/this-repo/gnosis/contracts/DeployGnosis.s.sol script/deployParameters/
# forge build compiles ALL of script/; at 2.1.0 every sibling uses the same 10-field
# struct so they compile. If any sibling errors anyway, delete them (only DeployGnosis is needed):
#   find script/deployParameters -name 'Deploy*.s.sol' ! -name 'DeployGnosis.s.sol' -delete
forge build
forge script script/deployParameters/DeployGnosis.s.sol:DeployGnosis \
  --rpc-url "$RPC_GNOSIS" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
```

> **Verification uses Etherscan V2.** Pass `--verifier etherscan --chain 100` and let
> Foundry use its default endpoint (`https://api.etherscan.io/v2/api`) — do **NOT** pass
> `--verifier-url https://api.gnosisscan.io/api`; the per-chain gnosisscan.io V1 API is
> deprecated. `ETHERSCAN_API_KEY` is a single **unified** Etherscan key (one key, all
> chains), not a gnosisscan-only key. (Mirrors `gnosis/contracts/sdai-zap/README.md`.)

[`DeployGnosis.s.sol`](./DeployGnosis.s.sol) carries the verified params (matches the
10-field 2.1.0 `RouterParameters` struct). Deploy cost on Gnosis is a few cents. Record the
`Universal Router Deployed:` address from the output.

> **Current deployment (chain 100, 2026-06-28).** UniversalRouter
> `0xF4f2b4C183a3d412F5de04236c318940ac8e415e` (2.1.0 / commit `67553d8b`), with its
> own `UnsupportedProtocol` stub `0x7260976D61CAaD773600B81Dd3dec0d237417065`. This is
> wired into `apps/web/.env` + `apps/web/.env.production`. It **replaces** the broken
> `0xa437dC83CDDa879167a40114706F6EB0558E6d7c` (commit `cb222d3`, 6-field — reverted
> `SliceOutOfBounds()` on every swap). Verified on-chain: feeding the new router the
> SDK's 5-field `V3_SWAP_EXACT_IN` input returns `0xd81b2f2e` (AllowanceExpired, i.e. it
> **decodes**), where the old one returned `0x3b99b53d` (SliceOutOfBounds).

> **Pre-deploy facts (verified on chain 100 this session with `cast`):** V3 Factory,
> NonfungiblePositionManager, QuoterV2, SwapRouter02 and **Permit2 (canonical)** all
> have code; **UniversalRouter is the only missing piece**. `poolInitCodeHash`
> `0xe34f199b…` reproduces the real USDC.e/WXDAI pool via CREATE2.

> **On "1:1 bytecode":** the deployed runtime bytecode will **not** byte-match
> mainnet/Arbitrum UR — UR bakes its wiring (Permit2, WXDAI, factory, the freshly
> deployed UnsupportedProtocol stub, …) in as **immutables**, which are Gnosis-specific.
> That's correct. Verify by source on Gnosisscan + a live swap, not by byte-diff.

### Dry run + proof the SliceOutOfBounds bug is fixed (do this before mainnet)
```bash
anvil --fork-url "$RPC_GNOSIS" --port 8545 &   # local Gnosis fork
forge script script/deployParameters/DeployGnosis.s.sol:DeployGnosis \
  --rpc-url http://localhost:8545 --private-key <anvil-acct0-key> --broadcast
# note the "Universal Router Deployed:" address -> $NEW_UR

# Decode proof: feed the deployed router the SAME 5-field V3_SWAP_EXACT_IN input the app
# produces (here wstETH->sDAI), with a fresh future deadline so checkDeadline passes.
DL=$(( $(date +%s) + 3600 ))
IN5=$(cast abi-encode "f(address,uint256,uint256,bytes,bool)" \
  0x509ad7278a2f6530bc24590c83e93faf8fd46e99 1 1 \
  0x6c76971f98945ae98dd7d4dfca8711ebea946ea60001f4af204776c7245bf4147c2612bf6e5972ee483701 true)
CD=$(cast calldata "execute(bytes,bytes[],uint256)" 0x00 "[$IN5]" $DL)
cast call $NEW_UR $CD --rpc-url http://localhost:8545 2>&1
# PASS = the revert is NO LONGER 0x3b99b53d (SliceOutOfBounds). It will instead fail later
# (e.g. Permit2 AllowanceExpired / transfer) or succeed once allowances+balance exist — i.e.
# the command DECODES. On the old cb222d3 router this exact call returns 0x3b99b53d.

# Full proof: point the app's REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS at $NEW_UR and run a
# real swap against the fork before touching mainnet.
```

## 3. Wiring addresses back into the app

- **Permit2**: nothing to do if deployed at the canonical address (SDK default).
- **UniversalRouter**: set `UNIVERSAL_ROUTER_ADDRESS` in your env and wire it into
  the Gnosis swap path. The app resolves the UR address per chain via
  `@uniswap/universal-router-sdk` `UNIVERSAL_ROUTER_ADDRESS(version, 100)`, which
  has no entry for Gnosis. Two options:
  1. **Recommended** — override it in the Gnosis swap repository (see
     `gnosis/README.md` → "Swap routing"), reading the address from chain config
     rather than the SDK, so no SDK patch is needed.
  2. Patch `@uniswap/universal-router-sdk` to add chain 100 (same `bun patch`
     workflow used for sdk-core).

## 4. Verify everything has code

```bash
forge script script/CheckDeployments.s.sol --rpc-url "$GNOSIS_RPC_URL"
```

`CheckDeployments.s.sol` asserts that every address the app depends on actually has
bytecode on Gnosis (catches a missing Permit2/UR before users hit a dead tx).
