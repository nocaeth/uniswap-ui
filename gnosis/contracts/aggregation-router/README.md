# GnosisAggregationRouter

Exact-input, Gnosis-only aggregation router for composing:

- Uniswap V3 `SwapRouter02.exactInput`
- Curve Router NG `exchange`
- USDC transmuter `deposit` / `withdraw`

The router is intentionally ownerless. Curve routes are allowlisted by constructor-pinned
`keccak256(abi.encode(route, swapParams, pools))` hashes; adding more Curve routes requires
redeploying.

## Deploy

Set the verified Curve Router NG address first. Pass the expected Curve runtime codehash
when deploying; the script refuses to deploy against a mismatched router when this env is
set.

```bash
export REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS=0x0DCDED3545D565bA3B19E683431381007245d983
export EXPECTED_GNOSIS_CURVE_ROUTER_CODEHASH="$(cast codehash "$REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS" --rpc-url "$RPC_GNOSIS")"
forge script script/DeployGnosisAggregationRouter.s.sol:DeployGnosisAggregationRouter \
  --rpc-url "$RPC_GNOSIS" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
```

Current deployment:

```bash
REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS=0xC617d916822E554F3a8660D620325Ca4c2f1f1aD
```

The UI defaults to the production Curve Router NG and GnosisAggregationRouter addresses. Env vars can
still override them for tests or replacement deployments.

Run the root deployment checker before enabling the UI. Codehash envs are optional, but should be set
for production release checks:

```bash
export EXPECTED_GNOSIS_CURVE_ROUTER_CODEHASH="$(cast codehash 0x0DCDED3545D565bA3B19E683431381007245d983 --rpc-url "$RPC_GNOSIS")"
export EXPECTED_GNOSIS_AGGREGATION_ROUTER_CODEHASH="$(cast codehash 0xC617d916822E554F3a8660D620325Ca4c2f1f1aD --rpc-url "$RPC_GNOSIS")"
forge script gnosis/contracts/CheckDeployments.s.sol --rpc-url "$RPC_GNOSIS"
```

The checker verifies exact Curve/aggregation addresses, optional codehashes, router immutables, and
that every curated Curve route hash is allowed.
