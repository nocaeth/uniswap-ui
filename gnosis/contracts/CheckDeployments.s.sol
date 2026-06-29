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

interface IGnosisAggregationRouterWiringCheck {
    function swapRouter() external view returns (address);
    function curveRouter() external view returns (address);
    function usdcTransmuter() external view returns (address);
    function USDC() external view returns (address);
    function USDCE() external view returns (address);
}

/// @notice Asserts that every contract the Gnosis-only UI depends on is the expected deployment.
/// Run BEFORE pointing users at the app:
///   forge script CheckDeployments.s.sol --rpc-url "$GNOSIS_RPC_URL"
/// Set REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS, REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS,
/// and REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS in env.
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
    address private constant CURVE_X3CRV = 0x1337BedC9D22ecbe766dF105c9623922A27963EC;
    address private constant CURVE_USDCE_SDAI = 0x4a053d86BccCdFB6f85c46B38C5873129212dc1F;
    address private constant CURVE_GNO_OSGNO = 0xb5814811dC4fC2aC127A1F8Fb708460bF9Fad619;
    address private constant CURVE_EURE_X3CRV = 0x056C6C5e684CeC248635eD86033378Cc444459B0;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address private constant EXPECTED_UNIVERSAL_ROUTER = 0xF4f2b4C183a3d412F5de04236c318940ac8e415e;
    address private constant EXPECTED_SDAI_ZAP = 0xd3B13be5822Bcf3949F447840Db33D5556f96824;
    address private constant EXPECTED_CURVE_ROUTER = 0x0DCDED3545D565bA3B19E683431381007245d983;
    address private constant EXPECTED_AGGREGATION_ROUTER_V2 = 0x5Dc8F465Eb018dA68d61fFdB9B4658C8f929CD13;
    bytes32 private constant EXPECTED_UNIVERSAL_ROUTER_CODEHASH =
        0x209fd2a960560715f5abe1413086b46d5c8cc1de09fccdc4582842eaaf3c9cbb;
    bytes32 private constant EXPECTED_SDAI_ZAP_CODEHASH =
        0x0f75440fa5bd1160ae534d521d9810b2a51fe828318666cf72d01306f487221f;
    bytes32 private constant EXPECTED_CURVE_X3POOL_CODEHASH =
        0x855fc847a134dc1d35593a59c460e334938f53cb115b2befa8174138a1bb3df6;
    bytes32 private constant EXPECTED_CURVE_X3CRV_CODEHASH =
        0x3645b2b0c950b93b1e78f4fd030d3a472ae1176f4a77d5b2a6bb482dc0f35cef;
    bytes32 private constant EXPECTED_CURVE_USDCE_SDAI_CODEHASH =
        0xf45eb6614ddec302ea893b07e94b59ed76d8c8e3c8557a1a51a1118f92fdc5b5;
    bytes32 private constant EXPECTED_CURVE_GNO_OSGNO_CODEHASH =
        0xffcbc014a68c4472c911758f87af0f9edade7495bd8d05e29cf8f36657ee6b8f;
    bytes32 private constant EXPECTED_CURVE_EURE_X3CRV_CODEHASH =
        0x52c642e1531350a62924087f8a60e389de030c1a147795329298419af6ff9972;
    bytes32 private constant EXPECTED_CURVE_ROUTER_CODEHASH =
        0x38dc1cc456be010539e596d2ee0aa82c271316bdc6daaaffea7990a0c47176ee;
    bytes32 private constant EXPECTED_AGGREGATION_ROUTER_V2_CODEHASH =
        0xcb438b9793299d3965e771b0b3fb45a1fb03f8192ae3abcc1b0387d6a9be453c;

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

        address curveRouter = vm.envOr("REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS", EXPECTED_CURVE_ROUTER);
        address aggregationRouter = vm.envOr("REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS", address(0));
        require(curveRouter == EXPECTED_CURVE_ROUTER, "Unexpected REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS");
        require(aggregationRouter != address(0), "Set REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS");
        require(
            aggregationRouter == EXPECTED_AGGREGATION_ROUTER_V2,
            "Unexpected REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS"
        );
        _requireCodeHash("Curve Router NG", curveRouter, EXPECTED_CURVE_ROUTER_CODEHASH);
        _requireCodeHash("Curve x3pool", CURVE_X3POOL, EXPECTED_CURVE_X3POOL_CODEHASH);
        _requireCodeHash("Curve x3CRV", CURVE_X3CRV, EXPECTED_CURVE_X3CRV_CODEHASH);
        _requireCodeHash("Curve USDC.e/sDAI", CURVE_USDCE_SDAI, EXPECTED_CURVE_USDCE_SDAI_CODEHASH);
        _requireCodeHash("Curve GNO/osGNO", CURVE_GNO_OSGNO, EXPECTED_CURVE_GNO_OSGNO_CODEHASH);
        _requireCodeHash("Curve EURe/x3CRV", CURVE_EURE_X3CRV, EXPECTED_CURVE_EURE_X3CRV_CODEHASH);
        _requireAggregationRouterWiring(aggregationRouter, curveRouter);
        _requireCodeHash("GnosisAggregationRouter V2", aggregationRouter, EXPECTED_AGGREGATION_ROUTER_V2_CODEHASH);
        console2.log("ok: GnosisAggregationRouter uses trusted Curve Router NG mode");

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
        IGnosisAggregationRouterWiringCheck r = IGnosisAggregationRouterWiringCheck(router);
        require(r.swapRouter() == SWAP_ROUTER_02, "AggregationRouter SwapRouter02 mismatch");
        require(r.curveRouter() == curveRouter, "AggregationRouter Curve router mismatch");
        require(r.usdcTransmuter() == USDC_TRANSMUTER, "AggregationRouter transmuter mismatch");
        require(r.USDC() == USDC, "AggregationRouter USDC mismatch");
        require(r.USDCE() == USDCE, "AggregationRouter USDC.e mismatch");

        console2.log("ok: GnosisAggregationRouter immutables");
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
