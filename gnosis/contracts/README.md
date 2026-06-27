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
git clone https://github.com/Uniswap/permit2 && cd permit2
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

> **Version, the right way.** The app pins `UniversalRouterVersion._2_0`
> (`supportedURVersions` in `gnosis.ts`), which is an `@uniswap/universal-router-sdk`
> command-set version — **not** a contract git tag. The repo's `v1.x` tags are the
> old NFT-aggregator UR (the SDK's `"1.2"` line) — wrong contract. The V4-capable UR
> the SDK `"2.0"/"2.1"` targets lives on **`main`**. Pin the exact commit verified
> here: **`cb222d358a2ea780feedee6990ff8a3c185301bf`** ("UR 2.1.1"). A UR built from
> this commit + the Gnosis params executed a real WXDAI→USDC.e swap on a Gnosis fork,
> so it's command-compatible with the app's `_2_0` pin.

```bash
git clone https://github.com/Uniswap/universal-router && cd universal-router
git checkout cb222d358a2ea780feedee6990ff8a3c185301bf
forge install                  # lib/ submodules (forge-std, v4-periphery, …)
yarn install --ignore-engines  # REQUIRED: node_modules/@uniswap/{v2-core,v3-core}
                               # Needs Node >= 18 (a Hardhat dev-dep, @nomicfoundation/edr,
                               # demands it). --ignore-engines skips that check on Node 16
                               # (edr is unused by forge build); or `fnm use 20` first.
                               # The v2/v3-core imports resolve from node_modules, not lib/.
cp /path/to/this-repo/gnosis/contracts/DeployGnosis.s.sol script/deployParameters/
# forge build compiles ALL of script/, and some sibling chain configs are stale vs
# the 11-field struct (e.g. DeployTempo has 10 -> compile error). Remove them; only
# DeployGnosis is needed (no test imports the others; the base script is one dir up).
find script/deployParameters -name 'Deploy*.s.sol' ! -name 'DeployGnosis.s.sol' -delete
forge build
forge script script/deployParameters/DeployGnosis.s.sol:DeployGnosis \
  --rpc-url "$RPC_GNOSIS" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --verify --verifier etherscan --verifier-url https://api.gnosisscan.io/api \
  --etherscan-api-key "$GNOSISSCAN_API_KEY"
```

[`DeployGnosis.s.sol`](./DeployGnosis.s.sol) carries the verified params (matches the
11-field struct at that commit). Deploy cost on Gnosis is a few cents. Record the
`Universal Router Deployed:` address from the output.

> **Pre-deploy facts (verified on chain 100 this session with `cast`):** V3 Factory,
> NonfungiblePositionManager, QuoterV2, SwapRouter02 and **Permit2 (canonical)** all
> have code; **UniversalRouter is the only missing piece**. `poolInitCodeHash`
> `0xe34f199b…` reproduces the real USDC.e/WXDAI pool via CREATE2.

> **On "1:1 bytecode":** the deployed runtime bytecode will **not** byte-match
> mainnet/Arbitrum UR — UR bakes its wiring (Permit2, WXDAI, factory, the freshly
> deployed UnsupportedProtocol stub, …) in as **immutables**, which are Gnosis-specific.
> That's correct. Verify by source on Gnosisscan + a live swap, not by byte-diff.

### Optional dry run (recommended)
```bash
anvil --fork-url "$RPC_GNOSIS" --port 8545 &   # local Gnosis fork
forge script script/deployParameters/DeployGnosis.s.sol:DeployGnosis \
  --rpc-url http://localhost:8545 --private-key <anvil-acct0-key> --broadcast
# then run gnosis/.../swap-proof against the deployed address before touching mainnet
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
