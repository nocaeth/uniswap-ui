// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SdaiZapRouter} from "../src/SdaiZapRouter.sol";

/// Deploys SdaiZapRouter wired to the canonical Gnosis (100) addresses.
/// Verification uses the unified Etherscan V2 API (chainid via --chain); the deprecated
/// gnosisscan.io V1 endpoint will fail, so do NOT pass --verifier-url for it.
///   forge script script/DeploySdaiZap.s.sol:DeploySdaiZap \
///     --rpc-url "$RPC_GNOSIS" --account gnosis-deployer --broadcast \
///     --verify --verifier etherscan --chain 100 --etherscan-api-key "$ETHERSCAN_API_KEY"
contract DeploySdaiZap is Script {
    address constant WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    address constant SDAI = 0xaf204776c7245bF4147c2612BF6e5972Ee483701;
    address constant SAVINGS_XDAI_ADAPTER = 0xD499b51fcFc66bd31248ef4b28d656d67E591A94;
    address constant SWAP_ROUTER_02 = 0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be;

    function run() external returns (SdaiZapRouter zap) {
        vm.startBroadcast();
        zap = new SdaiZapRouter(WXDAI, SDAI, SAVINGS_XDAI_ADAPTER, SWAP_ROUTER_02);
        vm.stopBroadcast();
        console2.log("SdaiZapRouter deployed:", address(zap));
    }
}
