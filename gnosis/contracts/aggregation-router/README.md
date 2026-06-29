# GnosisAggregationRouter

Exact-input, Gnosis-only aggregation router for composing:

- Uniswap V3 `SwapRouter02.exactInput`
- Curve Router NG `exchange`
- USDC transmuter `deposit` / `withdraw`

The routers are intentionally ownerless and only call immutable dependencies.

- V1 allowlists Curve routes by constructor-pinned
  `keccak256(abi.encode(route, swapParams, pools))` hashes.
- V2 trusts the configured Curve Router NG and accepts any Curve route that Router NG accepts. This
  removes the need to redeploy for new Curve pools, but makes the V2 bytecode and Curve Router NG
  codehash the production trust boundary.

## Deploy V2

The V2 deploy script hard-pins the Gnosis SwapRouter02, USDC transmuter, and Curve Router NG runtime
codehashes. It refuses to deploy against any other Curve Router NG address.

From the repo root:

```bash
export REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS=0x0DCDED3545D565bA3B19E683431381007245d983
forge script gnosis/contracts/aggregation-router/script/DeployGnosisAggregationRouterV2.s.sol:DeployGnosisAggregationRouterV2 \
  --root gnosis/contracts/aggregation-router \
  --rpc-url "$RPC_GNOSIS" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
```

After deployment, update `CheckDeployments.s.sol` if this is a replacement V2. For the current
production V2, export the address and run the root checker:

```bash
export REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS=<printed-v2-address>
forge script gnosis/contracts/CheckDeployments.s.sol --rpc-url "$RPC_GNOSIS" \
  --remappings forge-std/=gnosis/contracts/sdai-zap/lib/forge-std/src/
```

Previous V1 deployment (not compatible with this frontend's V2 route set):

```bash
REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS=0xC617d916822E554F3a8660D620325Ca4c2f1f1aD
```

The UI defaults to the production Curve Router NG and GnosisAggregationRouter addresses. Env vars can
still override them for tests or replacement deployments.

## Rollback / Disable

The current frontend emits Curve Router NG routes that V1 cannot execute, including the EURe/x3CRV
metapool route. Do not rebuild this frontend with the V1 address as a rollback. To disable
aggregation entirely, rebuild with:

```bash
REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS=0x0000000000000000000000000000000000000000
```

Do not unset the env var to disable aggregation; the frontend constant falls back to the production
V2 deployment.

## V1 Deploy

Use this only to redeploy the allowlisted V1 router:

```bash
export REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS=0x0DCDED3545D565bA3B19E683431381007245d983
forge script gnosis/contracts/aggregation-router/script/DeployGnosisAggregationRouter.s.sol:DeployGnosisAggregationRouter \
  --root gnosis/contracts/aggregation-router \
  --rpc-url "$RPC_GNOSIS" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
```
