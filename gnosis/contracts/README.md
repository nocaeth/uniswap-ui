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
must be wired back into the app (step 3). Deploy from the official repo, pinned to
the tag whose `UniversalRouterVersion` matches `supportedURVersions` in
`packages/uniswap/src/features/chains/evm/info/gnosis.ts` (currently `_2_0`).

```bash
git clone https://github.com/Uniswap/universal-router && cd universal-router
git checkout <tag-matching-v2_0>
forge install && forge build
```

Create a params entry for Gnosis using the values in
[`gnosis-router-parameters.json`](./gnosis-router-parameters.json) and run that
repo's deploy script against Gnosis (the repo reads params from
`script/deployParameters/`). Because UR's `RouterParameters` struct fields vary by
tag, copy the values from the JSON into the struct fields present in your chosen
tag; leave V2/V4 fields as the zero address / zero hash (Gnosis is V3-only).

After broadcast, record the deployed address.

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
