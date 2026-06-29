// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GnosisAggregationRouterV2} from "../src/GnosisAggregationRouterV2.sol";
import {MockCurveRouter, MockToken, MockUSDCTransmuter, MockV3SwapRouter} from "./GnosisAggregationRouter.t.sol";

interface ICurveRouterNgFork {
    function get_dy(
        address[11] calldata route,
        uint256[5][5] calldata swapParams,
        uint256 amount,
        address[5] calldata pools
    ) external view returns (uint256);
}

contract GnosisAggregationRouterV2Test is Test {
    MockToken usdc;
    MockToken usdce;
    MockToken wxdai;
    MockUSDCTransmuter transmuter;
    MockV3SwapRouter v3;
    MockCurveRouter curve;
    GnosisAggregationRouterV2 router;

    address constant CURVE_POOL = 0x1000000000000000000000000000000000000001;
    address constant GNOSIS_CURVE_ROUTER_NG = 0x0DCDED3545D565bA3B19E683431381007245d983;
    address constant GNOSIS_WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    address constant GNOSIS_EURE_V1 = 0xcB444e90D8198415266c6a2724b7900fb12FC56E;
    address constant GNOSIS_CURVE_X3POOL = 0x7f90122BF0700F9E7e1F688fe926940E8839F353;
    address constant GNOSIS_CURVE_X3CRV = 0x1337BedC9D22ecbe766dF105c9623922A27963EC;
    address constant GNOSIS_CURVE_EURE_X3CRV = 0x056C6C5e684CeC248635eD86033378Cc444459B0;
    uint24 constant FEE_LOW = 500;

    address user = makeAddr("user");
    address recipient = makeAddr("recipient");

    function setUp() public {
        usdc = new MockToken("USD Coin from Ethereum", "USDC", 6);
        usdce = new MockToken("Bridged USDC", "USDC.e", 6);
        wxdai = new MockToken("Wrapped xDAI", "WXDAI", 18);
        transmuter = new MockUSDCTransmuter(usdc, usdce);
        v3 = new MockV3SwapRouter();
        curve = new MockCurveRouter();

        v3.setRate(address(usdce), address(usdc), 10_000);
        curve.setRate(address(usdc), address(wxdai), 11_000);

        router = new GnosisAggregationRouterV2(address(v3), address(curve), address(transmuter));
        usdc.mint(address(transmuter), 10_000_000);
    }

    function test_execute_acceptsCurveRouteWithoutAllowlist() public {
        uint256 amountIn = 100_000;
        usdc.mint(user, amountIn);

        GnosisAggregationRouterV2.Leg[] memory legs = new GnosisAggregationRouterV2.Leg[](1);
        legs[0] = _curveLeg(amountIn, address(usdc), address(wxdai), 0);

        vm.startPrank(user);
        usdc.approve(address(router), amountIn);
        uint256 amountOut =
            router.execute(address(usdc), amountIn, address(wxdai), 109_000, recipient, block.timestamp + 1, legs);
        vm.stopPrank();

        assertEq(amountOut, 110_000);
        assertEq(wxdai.balanceOf(recipient), 110_000);
        assertEq(usdc.allowance(address(router), address(curve)), 0);
        assertEq(wxdai.balanceOf(address(router)), 0);
    }

    function test_execute_composesV3ThenCurveInOneLeg() public {
        uint256 amountIn = 100_000;
        usdce.mint(user, amountIn);

        GnosisAggregationRouterV2.Leg[] memory legs = new GnosisAggregationRouterV2.Leg[](1);
        legs[0] = _v3CurveLeg(amountIn, 0, 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        uint256 amountOut =
            router.execute(address(usdce), amountIn, address(wxdai), 109_000, recipient, block.timestamp + 1, legs);
        vm.stopPrank();

        assertEq(amountOut, 110_000);
        assertEq(wxdai.balanceOf(recipient), 110_000);
        assertEq(usdce.allowance(address(router), address(v3)), 0);
        assertEq(usdc.allowance(address(router), address(curve)), 0);
    }

    function test_execute_revertsWhenCurveRouteStartsAtWrongToken() public {
        uint256 amountIn = 100_000;
        usdc.mint(user, amountIn);

        GnosisAggregationRouterV2.Leg[] memory legs = new GnosisAggregationRouterV2.Leg[](1);
        legs[0] = _curveLeg(amountIn, address(usdce), address(wxdai), 0);

        vm.startPrank(user);
        usdc.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouterV2.CurveRouteEndpointMismatch.selector);
        router.execute(address(usdc), amountIn, address(wxdai), 1, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_constructor_revertsWhenDependencyHasNoCode() public {
        vm.expectRevert(GnosisAggregationRouterV2.DependencyNoCode.selector);
        new GnosisAggregationRouterV2(address(0xBEEF), address(curve), address(transmuter));

        vm.expectRevert(GnosisAggregationRouterV2.DependencyNoCode.selector);
        new GnosisAggregationRouterV2(address(v3), address(0xBEEF), address(transmuter));

        vm.expectRevert(GnosisAggregationRouterV2.DependencyNoCode.selector);
        new GnosisAggregationRouterV2(address(v3), address(curve), address(0xBEEF));
    }

    function testFork_curveRouterNgQuotesEureUsdMetapoolRoute() public {
        string memory rpcUrl = vm.envOr("GNOSIS_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            return;
        }
        vm.createSelectFork(rpcUrl);

        (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools) =
            _gnosisWxdaiToLegacyEureRoute();
        uint256 amountOut = ICurveRouterNgFork(GNOSIS_CURVE_ROUTER_NG).get_dy(route, swapParams, 1_000 ether, pools);

        assertGt(amountOut, 0);
    }

    function _v3CurveLeg(uint256 amountIn, uint256 v3MinOut, uint256 curveMinOut)
        internal
        view
        returns (GnosisAggregationRouterV2.Leg memory leg)
    {
        leg.amountIn = amountIn;
        leg.steps = new GnosisAggregationRouterV2.Step[](2);
        bytes memory path = abi.encodePacked(address(usdce), FEE_LOW, address(usdc));
        leg.steps[0] = GnosisAggregationRouterV2.Step({
            stepType: GnosisAggregationRouterV2.StepType.V3, data: abi.encode(path, v3MinOut)
        });
        leg.steps[1] = _curveStep(address(usdc), address(wxdai), curveMinOut);
    }

    function _curveLeg(uint256 amountIn, address tokenIn, address tokenOut, uint256 amountOutMinimum)
        internal
        pure
        returns (GnosisAggregationRouterV2.Leg memory leg)
    {
        leg.amountIn = amountIn;
        leg.steps = new GnosisAggregationRouterV2.Step[](1);
        leg.steps[0] = _curveStep(tokenIn, tokenOut, amountOutMinimum);
    }

    function _curveStep(address tokenIn, address tokenOut, uint256 amountOutMinimum)
        internal
        pure
        returns (GnosisAggregationRouterV2.Step memory step)
    {
        address[11] memory route;
        uint256[5][5] memory swapParams;
        address[5] memory pools;
        route[0] = tokenIn;
        route[1] = CURVE_POOL;
        route[2] = tokenOut;
        swapParams[0] = [uint256(0), uint256(1), uint256(1), uint256(1), uint256(2)];
        pools;

        step = GnosisAggregationRouterV2.Step({
            stepType: GnosisAggregationRouterV2.StepType.Curve,
            data: abi.encode(route, swapParams, pools, amountOutMinimum)
        });
    }

    function _gnosisWxdaiToLegacyEureRoute()
        internal
        pure
        returns (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools)
    {
        route[0] = GNOSIS_WXDAI;
        route[1] = GNOSIS_CURVE_X3POOL;
        route[2] = GNOSIS_CURVE_X3CRV;
        route[3] = GNOSIS_CURVE_EURE_X3CRV;
        route[4] = GNOSIS_EURE_V1;
        swapParams[0] = [uint256(0), uint256(0), uint256(4), uint256(1), uint256(3)];
        swapParams[1] = [uint256(1), uint256(0), uint256(1), uint256(2), uint256(2)];
        pools;
    }
}
