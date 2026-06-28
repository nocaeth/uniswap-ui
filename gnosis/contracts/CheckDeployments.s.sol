// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script, console2} from "forge-std/Script.sol";

interface ISdaiZapRouterCheck {
    function WXDAI() external view returns (address);
    function SDAI() external view returns (address);
    function adapter() external view returns (address);
    function swapRouter() external view returns (address);
}

/// @notice Asserts that every contract the Gnosis-only UI depends on is the expected deployment.
/// Run BEFORE pointing users at the app:
///   forge script CheckDeployments.s.sol --rpc-url "$GNOSIS_RPC_URL"
/// Set REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS and REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS in env.
contract CheckDeployments is Script {
    address private constant V3_FACTORY = 0xe32F7dD7e3f098D518ff19A22d5f028e076489B1;
    address private constant LEGACY_MULTICALL = 0x4dfa9a980efE4802E969AC33968E3d6E59B8a19e;
    address private constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address private constant QUOTER_V2 = 0x7E9cB3499A6cee3baBe5c8a3D328EA7FD36578f4;
    address private constant SWAP_ROUTER_02 = 0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be;
    address private constant POSITION_MANAGER = 0xAE8fbE656a77519a7490054274910129c9244FA3;
    address private constant TICK_LENS = 0x8fe3D346B53dCA838B228e0e53aCdBED5DEC70Dc;
    address private constant V3_MIGRATOR = 0x16dd75c567a07082452aB56fD1E673987289E6Ef;
    address private constant WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    address private constant SDAI = 0xaf204776c7245bF4147c2612BF6e5972Ee483701;
    address private constant SDAI_ADAPTER = 0xD499b51fcFc66bd31248ef4b28d656d67E591A94;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address private constant EXPECTED_UNIVERSAL_ROUTER = 0xF4f2b4C183a3d412F5de04236c318940ac8e415e;
    address private constant EXPECTED_SDAI_ZAP = 0xd3B13be5822Bcf3949F447840Db33D5556f96824;
    bytes32 private constant EXPECTED_UNIVERSAL_ROUTER_CODEHASH =
        0x209fd2a960560715f5abe1413086b46d5c8cc1de09fccdc4582842eaaf3c9cbb;
    bytes32 private constant EXPECTED_SDAI_ZAP_CODEHASH =
        0x0f75440fa5bd1160ae534d521d9810b2a51fe828318666cf72d01306f487221f;

    bytes4 private constant UR_EXECUTE_SELECTOR = 0x3593564c;
    bytes4 private constant SLICE_OUT_OF_BOUNDS_SELECTOR = 0x3b99b53d;

    function run() external {
        // Already-deployed official V3 stack (from the recognized Gnosis deployment).
        _require("UniswapV3Factory", V3_FACTORY);
        _require("Multicall", LEGACY_MULTICALL);
        _require("Multicall3", MULTICALL3);
        _require("QuoterV2", QUOTER_V2);
        _require("SwapRouter02", SWAP_ROUTER_02);
        _require("NonfungiblePositionManager", POSITION_MANAGER);
        _require("TickLens", TICK_LENS);
        _require("V3Migrator", V3_MIGRATOR);
        _require("WXDAI", WXDAI);
        _require("sDAI", SDAI);
        _require("Savings xDAI adapter", SDAI_ADAPTER);

        // Contracts we deploy.
        _require("Permit2", PERMIT2);

        address ur = vm.envAddress("REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS");
        require(ur == EXPECTED_UNIVERSAL_ROUTER, "Unexpected REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS");
        _requireCodeHash("UniversalRouter", ur, EXPECTED_UNIVERSAL_ROUTER_CODEHASH);
        _requireUniversalRouterDecodesSdkV3Swap(ur);

        address zap = vm.envAddress("REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS");
        require(zap == EXPECTED_SDAI_ZAP, "Unexpected REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS");
        _requireCodeHash("SdaiZapRouter", zap, EXPECTED_SDAI_ZAP_CODEHASH);
        _requireZapWiring(zap);

        console2.log("All checked contracts have bytecode on Gnosis.");
    }

    function _require(string memory name, address a) internal view {
        require(a.code.length > 0, string.concat(name, " has no code on Gnosis"));
        console2.log("ok:", name, a);
    }

    function _requireCodeHash(string memory name, address a, bytes32 expected) internal view {
        _require(name, a);
        require(a.codehash == expected, string.concat(name, " codehash mismatch"));
    }

    function _requireZapWiring(address zap) internal view {
        ISdaiZapRouterCheck z = ISdaiZapRouterCheck(zap);
        require(z.WXDAI() == WXDAI, "SdaiZapRouter WXDAI mismatch");
        require(z.SDAI() == SDAI, "SdaiZapRouter sDAI mismatch");
        require(z.adapter() == SDAI_ADAPTER, "SdaiZapRouter adapter mismatch");
        require(z.swapRouter() == SWAP_ROUTER_02, "SdaiZapRouter SwapRouter02 mismatch");
        console2.log("ok: SdaiZapRouter immutables");
    }

    function _requireUniversalRouterDecodesSdkV3Swap(address ur) internal {
        bytes memory path = hex"6c76971f98945ae98dd7d4dfca8711ebea946ea60001f4af204776c7245bf4147c2612bf6e5972ee483701";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(0x509Ad7278A2F6530Bc24590C83E93fAF8fd46E99), uint256(1), uint256(1), path, true);

        bytes memory data = abi.encodeWithSelector(UR_EXECUTE_SELECTOR, hex"00", inputs, block.timestamp + 30 minutes);
        (bool ok, bytes memory ret) = ur.call(data);

        require(!ok, "UniversalRouter golden SDK V3 call unexpectedly succeeded");
        require(_selector(ret) != bytes4(0), "UniversalRouter golden SDK V3 call reverted without selector");
        require(
            _selector(ret) != SLICE_OUT_OF_BOUNDS_SELECTOR,
            "UniversalRouter has 6-field V3 decode bug (SliceOutOfBounds)"
        );
        console2.log("ok: UniversalRouter decodes SDK V3_SWAP_EXACT_IN input");
    }

    function _selector(bytes memory data) internal pure returns (bytes4 selector) {
        if (data.length < 4) {
            return bytes4(0);
        }
        assembly {
            selector := mload(add(data, 32))
        }
    }
}
