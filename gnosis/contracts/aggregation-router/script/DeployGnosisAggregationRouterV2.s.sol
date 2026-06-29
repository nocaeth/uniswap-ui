// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GnosisAggregationRouterV2} from "../src/GnosisAggregationRouterV2.sol";

contract DeployGnosisAggregationRouterV2 is Script {
    address private constant SWAP_ROUTER_02 = 0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be;
    address private constant USDC_TRANSMUTER = 0x0392A2F5Ac47388945D8c84212469F545fAE52B2;
    address private constant EXPECTED_CURVE_ROUTER = 0x0DCDED3545D565bA3B19E683431381007245d983;
    bytes32 private constant EXPECTED_SWAP_ROUTER_02_CODEHASH =
        0x4d7621886df22214940ed9e069ac6e09b4dc0b30f03e30fe72eb9e97f622f40d;
    bytes32 private constant EXPECTED_USDC_TRANSMUTER_CODEHASH =
        0x69db9d29bb76f20c1c559e0f5516766c797e72f2ed803e827642383969bbbd33;
    bytes32 private constant EXPECTED_CURVE_ROUTER_CODEHASH =
        0x38dc1cc456be010539e596d2ee0aa82c271316bdc6daaaffea7990a0c47176ee;

    function run() external {
        address curveRouter = vm.envOr("REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS", EXPECTED_CURVE_ROUTER);
        require(curveRouter == EXPECTED_CURVE_ROUTER, "Unexpected Curve Router NG address");
        _requireCodeHash("SwapRouter02", SWAP_ROUTER_02, EXPECTED_SWAP_ROUTER_02_CODEHASH);
        _requireCodeHash("USDCTransmuter", USDC_TRANSMUTER, EXPECTED_USDC_TRANSMUTER_CODEHASH);
        _requireCodeHash("Curve Router NG", curveRouter, EXPECTED_CURVE_ROUTER_CODEHASH);

        vm.startBroadcast();
        GnosisAggregationRouterV2 router = new GnosisAggregationRouterV2(SWAP_ROUTER_02, curveRouter, USDC_TRANSMUTER);
        vm.stopBroadcast();

        console2.log("GnosisAggregationRouterV2 deployed:", address(router));
        console2.log("SwapRouter02:", SWAP_ROUTER_02);
        console2.log("Curve router:", curveRouter);
        console2.log("USDCTransmuter:", USDC_TRANSMUTER);
    }

    function _requireCodeHash(string memory name, address target, bytes32 expectedCodeHash) private view {
        require(target.code.length > 0, string.concat(name, " has no code on Gnosis"));
        require(target.codehash == expectedCodeHash, string.concat(name, " codehash mismatch"));
    }
}
