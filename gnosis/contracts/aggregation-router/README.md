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
export REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS=0x...
export EXPECTED_GNOSIS_CURVE_ROUTER_CODEHASH=0x...
forge script script/DeployGnosisAggregationRouter.s.sol:DeployGnosisAggregationRouter \
  --rpc-url "$RPC_GNOSIS" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
```

Then set:

```bash
REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS=0x...
```

Run the root deployment checker before enabling the UI:

```bash
export EXPECTED_GNOSIS_CURVE_ROUTER_ADDRESS="$REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS"
export EXPECTED_GNOSIS_CURVE_ROUTER_CODEHASH=0x...
export EXPECTED_GNOSIS_AGGREGATION_ROUTER_ADDRESS="$REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS"
export EXPECTED_GNOSIS_AGGREGATION_ROUTER_CODEHASH=0x...
forge script gnosis/contracts/CheckDeployments.s.sol --rpc-url "$RPC_GNOSIS"
```

The checker verifies exact Curve/aggregation addresses, codehashes, router immutables, and
that every curated x3pool route hash is allowed.
