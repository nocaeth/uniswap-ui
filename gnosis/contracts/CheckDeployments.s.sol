// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script, console2} from "forge-std/Script.sol";

interface ISdaiZapRouterCheck {
    function WXDAI() external view returns (address);
    function SDAI() external view returns (address);
    function adapter() external view returns (address);
    function swapRouter() external view returns (address);
}

interface IUSDCTransmuterCheck {
    function USDC_ON_XDAI() external view returns (address);
    function USDC_E() external view returns (address);
    function isEnabled() external view returns (bool);
}

interface IGnosisAggregationRouterCheck {
    function swapRouter() external view returns (address);
    function curveRouter() external view returns (address);
    function usdcTransmuter() external view returns (address);
    function USDC() external view returns (address);
    function USDCE() external view returns (address);
    function allowedCurveRouteHash(bytes32 routeHash) external view returns (bool);
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
    address private constant USDC = 0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83;
    address private constant USDCE = 0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0;
    address private constant USDT = 0x4ECaBa5870353805a9F068101A40E0f32ed605C6;
    address private constant GNO = 0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb;
    address private constant OSGNO = 0xF490c80aAE5f2616d3e3BDa2483E30C4CB21d1A0;
    address private constant USDC_TRANSMUTER = 0x0392A2F5Ac47388945D8c84212469F545fAE52B2;
    address private constant CURVE_X3POOL = 0x7f90122BF0700F9E7e1F688fe926940E8839F353;
    address private constant CURVE_USDCE_SDAI = 0x4a053d86BccCdFB6f85c46B38C5873129212dc1F;
    address private constant CURVE_GNO_OSGNO = 0xb5814811dC4fC2aC127A1F8Fb708460bF9Fad619;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address private constant EXPECTED_UNIVERSAL_ROUTER = 0xF4f2b4C183a3d412F5de04236c318940ac8e415e;
    address private constant EXPECTED_SDAI_ZAP = 0xd3B13be5822Bcf3949F447840Db33D5556f96824;
    bytes32 private constant EXPECTED_UNIVERSAL_ROUTER_CODEHASH =
        0x209fd2a960560715f5abe1413086b46d5c8cc1de09fccdc4582842eaaf3c9cbb;
    bytes32 private constant EXPECTED_SDAI_ZAP_CODEHASH =
        0x0f75440fa5bd1160ae534d521d9810b2a51fe828318666cf72d01306f487221f;
    bytes32 private constant EXPECTED_CURVE_X3POOL_CODEHASH =
        0x855fc847a134dc1d35593a59c460e334938f53cb115b2befa8174138a1bb3df6;
    bytes32 private constant EXPECTED_CURVE_USDCE_SDAI_CODEHASH =
        0xf45eb6614ddec302ea893b07e94b59ed76d8c8e3c8557a1a51a1118f92fdc5b5;
    bytes32 private constant EXPECTED_CURVE_GNO_OSGNO_CODEHASH =
        0xffcbc014a68c4472c911758f87af0f9edade7495bd8d05e29cf8f36657ee6b8f;

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
        _require("Omnibridge USDC", USDC);
        _require("USDC.e", USDCE);
        _require("USDT", USDT);
        _require("GNO", GNO);
        _require("osGNO", OSGNO);
        _require("USDCTransmuter", USDC_TRANSMUTER);
        _requireUsdcTransmuter();

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

        address aggregationRouter = vm.envOr("REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS", address(0));
        if (aggregationRouter != address(0)) {
            address curveRouter = vm.envAddress("REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS");
            address expectedCurveRouter = vm.envAddress("EXPECTED_GNOSIS_CURVE_ROUTER_ADDRESS");
            bytes32 expectedCurveRouterCodeHash = vm.envBytes32("EXPECTED_GNOSIS_CURVE_ROUTER_CODEHASH");
            address expectedAggregationRouter = vm.envAddress("EXPECTED_GNOSIS_AGGREGATION_ROUTER_ADDRESS");
            bytes32 expectedAggregationRouterCodeHash = vm.envBytes32("EXPECTED_GNOSIS_AGGREGATION_ROUTER_CODEHASH");

            require(curveRouter == expectedCurveRouter, "Unexpected REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS");
            require(
                aggregationRouter == expectedAggregationRouter, "Unexpected REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS"
            );
            _requireCodeHash("Curve Router NG", curveRouter, expectedCurveRouterCodeHash);
            _requireCodeHash("GnosisAggregationRouter", aggregationRouter, expectedAggregationRouterCodeHash);
            _requireCodeHash("Curve x3pool", CURVE_X3POOL, EXPECTED_CURVE_X3POOL_CODEHASH);
            _requireCodeHash("Curve USDC.e/sDAI", CURVE_USDCE_SDAI, EXPECTED_CURVE_USDCE_SDAI_CODEHASH);
            _requireCodeHash("Curve GNO/osGNO", CURVE_GNO_OSGNO, EXPECTED_CURVE_GNO_OSGNO_CODEHASH);
            _requireAggregationRouterWiring(aggregationRouter, curveRouter);
        }

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

    function _requireUsdcTransmuter() internal view {
        IUSDCTransmuterCheck t = IUSDCTransmuterCheck(USDC_TRANSMUTER);
        require(t.USDC_ON_XDAI() == USDC, "USDCTransmuter USDC mismatch");
        require(t.USDC_E() == USDCE, "USDCTransmuter USDC.e mismatch");
        require(t.isEnabled(), "USDCTransmuter disabled");
        console2.log("ok: USDCTransmuter wiring and enabled state");
    }

    function _requireAggregationRouterWiring(address router, address curveRouter) internal view {
        IGnosisAggregationRouterCheck r = IGnosisAggregationRouterCheck(router);
        require(r.swapRouter() == SWAP_ROUTER_02, "AggregationRouter SwapRouter02 mismatch");
        require(r.curveRouter() == curveRouter, "AggregationRouter Curve router mismatch");
        require(r.usdcTransmuter() == USDC_TRANSMUTER, "AggregationRouter transmuter mismatch");
        require(r.USDC() == USDC, "AggregationRouter USDC mismatch");
        require(r.USDCE() == USDCE, "AggregationRouter USDC.e mismatch");

        address[3] memory x3Tokens = [WXDAI, USDC, USDT];
        for (uint256 i = 0; i < x3Tokens.length; i++) {
            for (uint256 j = 0; j < x3Tokens.length; j++) {
                if (i == j) continue;
                _requireAggregationCurveRouteHash(r, CURVE_X3POOL, x3Tokens[i], x3Tokens[j], i, j, 1, 3);
            }
        }
        _requireAggregationCurveRouteHash(r, CURVE_USDCE_SDAI, USDCE, SDAI, 0, 1, 1, 2);
        _requireAggregationCurveRouteHash(r, CURVE_USDCE_SDAI, SDAI, USDCE, 1, 0, 1, 2);
        _requireAggregationCurveRouteHash(r, CURVE_GNO_OSGNO, GNO, OSGNO, 0, 1, 1, 2);
        _requireAggregationCurveRouteHash(r, CURVE_GNO_OSGNO, OSGNO, GNO, 1, 0, 1, 2);

        console2.log("ok: GnosisAggregationRouter immutables and Curve route allowlist");
    }

    function _requireAggregationCurveRouteHash(
        IGnosisAggregationRouterCheck router,
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 i,
        uint256 j,
        uint256 poolType,
        uint256 nCoins
    ) internal view {
        address[11] memory route;
        uint256[5][5] memory swapParams;
        address[5] memory pools;
        route[0] = tokenIn;
        route[1] = pool;
        route[2] = tokenOut;
        swapParams[0] = [i, j, uint256(1), poolType, nCoins];
        require(
            router.allowedCurveRouteHash(keccak256(abi.encode(route, swapParams, pools))),
            "AggregationRouter Curve route not allowed"
        );
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
