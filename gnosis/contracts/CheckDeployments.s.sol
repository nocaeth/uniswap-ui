// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script, console2} from "forge-std/Script.sol";

/// @notice Asserts that every contract the Gnosis-only UI depends on actually has
/// bytecode on Gnosis Chain (100). Run BEFORE pointing users at the app:
///   forge script script/CheckDeployments.s.sol --rpc-url "$GNOSIS_RPC_URL"
/// Set UNIVERSAL_ROUTER_ADDRESS in the env once UniversalRouter is deployed.
contract CheckDeployments is Script {
    function run() external view {
        // Already-deployed official V3 stack (from the recognized Gnosis deployment).
        _require("UniswapV3Factory", 0xe32F7dD7e3f098D518ff19A22d5f028e076489B1);
        _require("Multicall", 0x4dfa9a980efE4802E969AC33968E3d6E59B8a19e);
        _require("QuoterV2", 0x7E9cB3499A6cee3baBe5c8a3D328EA7FD36578f4);
        _require("SwapRouter02", 0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be);
        _require("NonfungiblePositionManager", 0xAE8fbE656a77519a7490054274910129c9244FA3);
        _require("TickLens", 0x8fe3D346B53dCA838B228e0e53aCdBED5DEC70Dc);
        _require("V3Migrator", 0x16dd75c567a07082452aB56fD1E673987289E6Ef);
        _require("WXDAI", 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d);

        // Contracts we deploy.
        _require("Permit2", 0x000000000022D473030F116dDEE9F6B43aC78BA3);

        address ur = vm.envOr("UNIVERSAL_ROUTER_ADDRESS", address(0));
        if (ur == address(0)) {
            console2.log("WARNING: UNIVERSAL_ROUTER_ADDRESS unset - skipping UR check");
        } else {
            _require("UniversalRouter", ur);
        }

        console2.log("All checked contracts have bytecode on Gnosis.");
    }

    function _require(string memory name, address a) internal view {
        require(a.code.length > 0, string.concat(name, " has no code on Gnosis"));
        console2.log("ok:", name, a);
    }
}
