// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GnosisAggregationRouter} from "../src/GnosisAggregationRouter.sol";

contract DeployGnosisAggregationRouter is Script {
    address private constant SWAP_ROUTER_02 = 0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be;
    address private constant USDC_TRANSMUTER = 0x0392A2F5Ac47388945D8c84212469F545fAE52B2;

    address private constant WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    address private constant USDC = 0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83;
    address private constant USDCE = 0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0;
    address private constant USDT = 0x4ECaBa5870353805a9F068101A40E0f32ed605C6;
    address private constant SDAI = 0xaf204776c7245bF4147c2612BF6e5972Ee483701;
    address private constant GNO = 0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb;
    address private constant OSGNO = 0xF490c80aAE5f2616d3e3BDa2483E30C4CB21d1A0;
    address private constant CURVE_X3POOL = 0x7f90122BF0700F9E7e1F688fe926940E8839F353;
    address private constant CURVE_USDCE_SDAI = 0x4a053d86BccCdFB6f85c46B38C5873129212dc1F;
    address private constant CURVE_GNO_OSGNO = 0xb5814811dC4fC2aC127A1F8Fb708460bF9Fad619;
    bytes32 private constant CURVE_X3POOL_CODEHASH = 0x855fc847a134dc1d35593a59c460e334938f53cb115b2befa8174138a1bb3df6;
    bytes32 private constant CURVE_USDCE_SDAI_CODEHASH =
        0xf45eb6614ddec302ea893b07e94b59ed76d8c8e3c8557a1a51a1118f92fdc5b5;
    bytes32 private constant CURVE_GNO_OSGNO_CODEHASH =
        0xffcbc014a68c4472c911758f87af0f9edade7495bd8d05e29cf8f36657ee6b8f;

    function run() external {
        address curveRouter = vm.envAddress("REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS");
        bytes32 expectedCurveRouterCodeHash = vm.envOr("EXPECTED_GNOSIS_CURVE_ROUTER_CODEHASH", bytes32(0));
        require(curveRouter.code.length > 0, "Curve Router NG has no code on Gnosis");
        if (expectedCurveRouterCodeHash != bytes32(0)) {
            require(curveRouter.codehash == expectedCurveRouterCodeHash, "Curve Router NG codehash mismatch");
        }
        _requireCurvePool("Curve x3pool", CURVE_X3POOL, CURVE_X3POOL_CODEHASH);
        _requireCurvePool("Curve USDC.e/sDAI", CURVE_USDCE_SDAI, CURVE_USDCE_SDAI_CODEHASH);
        _requireCurvePool("Curve GNO/osGNO", CURVE_GNO_OSGNO, CURVE_GNO_OSGNO_CODEHASH);

        bytes32[] memory routeHashes = _allowedCurveRouteHashes();

        vm.startBroadcast();
        GnosisAggregationRouter router =
            new GnosisAggregationRouter(SWAP_ROUTER_02, curveRouter, USDC_TRANSMUTER, routeHashes);
        vm.stopBroadcast();

        console2.log("GnosisAggregationRouter deployed:", address(router));
        console2.log("Curve router:", curveRouter);
        for (uint256 i = 0; i < routeHashes.length; i++) {
            console2.logBytes32(routeHashes[i]);
        }
    }

    function _allowedCurveRouteHashes() private pure returns (bytes32[] memory hashes) {
        address[3] memory tokens = [WXDAI, USDC, USDT];
        hashes = new bytes32[](10);
        uint256 k;
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = 0; j < tokens.length; j++) {
                if (i == j) continue;
                hashes[k++] = _curveRouteHash(CURVE_X3POOL, tokens[i], tokens[j], i, j, 1, 3);
            }
        }
        hashes[k++] = _curveRouteHash(CURVE_USDCE_SDAI, USDCE, SDAI, 0, 1, 1, 2);
        hashes[k++] = _curveRouteHash(CURVE_USDCE_SDAI, SDAI, USDCE, 1, 0, 1, 2);
        hashes[k++] = _curveRouteHash(CURVE_GNO_OSGNO, GNO, OSGNO, 0, 1, 1, 2);
        hashes[k++] = _curveRouteHash(CURVE_GNO_OSGNO, OSGNO, GNO, 1, 0, 1, 2);
    }

    function _requireCurvePool(string memory name, address pool, bytes32 expectedCodeHash) private view {
        require(pool.code.length > 0, string.concat(name, " has no code on Gnosis"));
        require(pool.codehash == expectedCodeHash, string.concat(name, " codehash mismatch"));
    }

    function _curveRouteHash(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 i,
        uint256 j,
        uint256 poolType,
        uint256 nCoins
    ) private pure returns (bytes32) {
        address[11] memory route;
        uint256[5][5] memory swapParams;
        address[5] memory pools;
        route[0] = tokenIn;
        route[1] = pool;
        route[2] = tokenOut;
        swapParams[0] = [i, j, uint256(1), poolType, nCoins];
        return keccak256(abi.encode(route, swapParams, pools));
    }
}
