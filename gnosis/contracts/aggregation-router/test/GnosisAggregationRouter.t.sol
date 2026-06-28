// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GnosisAggregationRouter} from "../src/GnosisAggregationRouter.sol";

contract MockToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "burn exceeds balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockUSDCTransmuter {
    MockToken public immutable usdc;
    MockToken public immutable usdce;
    bool public enabled = true;

    constructor(MockToken usdc_, MockToken usdce_) {
        usdc = usdc_;
        usdce = usdce_;
    }

    function USDC_ON_XDAI() external view returns (address) {
        return address(usdc);
    }

    function USDC_E() external view returns (address) {
        return address(usdce);
    }

    function isEnabled() external view returns (bool) {
        return enabled;
    }

    function setEnabled(bool enabled_) external {
        enabled = enabled_;
    }

    function deposit(uint256 amount) external {
        require(enabled, "disabled");
        require(usdc.transferFrom(msg.sender, address(this), amount), "usdc transfer");
        usdce.mint(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(enabled, "disabled");
        require(usdce.transferFrom(msg.sender, address(this), amount), "usdce transfer");
        usdce.burn(address(this), amount);
        require(usdc.transfer(msg.sender, amount), "usdc out");
    }
}

contract MockV3SwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    mapping(bytes32 => uint256) public rateBps;

    function setRate(address tokenIn, address tokenOut, uint256 bps) external {
        rateBps[_pairKey(tokenIn, tokenOut)] = bps;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        address tokenIn = _firstToken(params.path);
        address tokenOut = _lastToken(params.path);
        uint256 rate = rateBps[_pairKey(tokenIn, tokenOut)];
        require(rate != 0, "missing rate");

        amountOut = params.amountIn * rate / 10_000;
        require(amountOut >= params.amountOutMinimum, "min out");
        require(MockToken(tokenIn).transferFrom(msg.sender, address(this), params.amountIn), "pull");
        MockToken(tokenOut).mint(params.recipient, amountOut);
    }

    function _pairKey(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }

    function _firstToken(bytes calldata path) private pure returns (address token) {
        assembly {
            token := shr(96, calldataload(path.offset))
        }
    }

    function _lastToken(bytes calldata path) private pure returns (address token) {
        uint256 n = path.length;
        assembly {
            token := shr(96, calldataload(add(path.offset, sub(n, 20))))
        }
    }
}

contract MockCurveRouter {
    mapping(bytes32 => uint256) public rateBps;

    function setRate(address tokenIn, address tokenOut, uint256 bps) external {
        rateBps[_pairKey(tokenIn, tokenOut)] = bps;
    }

    function exchange(
        address[11] calldata route,
        uint256[5][5] calldata,
        uint256 amount,
        uint256 minDy,
        address[5] calldata,
        address receiver
    ) external payable returns (uint256 amountOut) {
        address tokenIn = route[0];
        address tokenOut = _curveOutputToken(route);
        uint256 rate = rateBps[_pairKey(tokenIn, tokenOut)];
        require(rate != 0, "missing rate");

        amountOut = amount * rate / 10_000;
        require(amountOut >= minDy, "min out");
        require(MockToken(tokenIn).transferFrom(msg.sender, address(this), amount), "pull");
        MockToken(tokenOut).mint(receiver, amountOut);
    }

    function _pairKey(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }

    function _curveOutputToken(address[11] calldata route) private pure returns (address outputToken) {
        outputToken = route[0];
        for (uint256 i = 0; i < 5; i++) {
            address poolOrZap = route[i * 2 + 1];
            if (poolOrZap == address(0)) {
                return outputToken;
            }
            outputToken = route[i * 2 + 2];
        }
    }
}

contract GnosisAggregationRouterTest is Test {
    MockToken usdc;
    MockToken usdce;
    MockToken wxdai;
    MockUSDCTransmuter transmuter;
    MockV3SwapRouter v3;
    MockCurveRouter curve;
    GnosisAggregationRouter router;

    address constant CURVE_POOL = 0x1000000000000000000000000000000000000001;
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

        v3.setRate(address(usdce), address(wxdai), 9_000); // 0.9 WXDAI per USDC.e in mock units
        curve.setRate(address(usdc), address(wxdai), 11_000); // 1.1 WXDAI per USDC after transmute
        curve.setRate(address(wxdai), address(usdc), 10_500);

        (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools) = _curveUsdcToWxdai();
        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = keccak256(abi.encode(route, swapParams, pools));
        router = new GnosisAggregationRouter(address(v3), address(curve), address(transmuter), allowed);

        // Inventory backing USDC.e -> USDC withdrawals.
        usdc.mint(address(transmuter), 10_000_000);
    }

    function test_execute_splitV3AndTransmuterCurve() public {
        uint256 amountIn = 1_000_000;
        usdce.mint(user, amountIn);

        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](2);
        legs[0] = _v3Leg(600_000, address(usdce), address(wxdai), 0);
        legs[1] = _transmuteCurveLeg(400_000, 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        uint256 amountOut =
            router.execute(address(usdce), amountIn, address(wxdai), 900_000, recipient, block.timestamp + 1, legs);
        vm.stopPrank();

        // V3 leg: 600k * 0.9 = 540k. Curve leg after transmute: 400k * 1.1 = 440k.
        assertEq(amountOut, 980_000);
        assertEq(wxdai.balanceOf(recipient), 980_000);
        assertEq(usdce.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(wxdai.balanceOf(address(router)), 0);
        assertEq(usdce.allowance(address(router), address(v3)), 0);
        assertEq(usdc.allowance(address(router), address(curve)), 0);
        assertEq(usdce.allowance(address(router), address(transmuter)), 0);
    }

    function test_execute_revertsWhenCurveRouteIsNotAllowed() public {
        uint256 amountIn = 100_000;
        usdce.mint(user, amountIn);
        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](1);
        legs[0] = _unallowedTransmuteCurveLeg(amountIn);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouter.CurveRouteNotAllowed.selector);
        router.execute(address(usdce), amountIn, address(wxdai), 1, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_execute_revertsWhenFinalMinOutMisses() public {
        uint256 amountIn = 100_000;
        usdce.mint(user, amountIn);
        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](1);
        legs[0] = _v3Leg(amountIn, address(usdce), address(wxdai), 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouter.InsufficientOutput.selector);
        router.execute(address(usdce), amountIn, address(wxdai), 100_000, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_execute_revertsWhenTransmuterDisabled() public {
        uint256 amountIn = 100_000;
        usdce.mint(user, amountIn);
        transmuter.setEnabled(false);
        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](1);
        legs[0] = _transmuteCurveLeg(amountIn, 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouter.TransmuterDisabled.selector);
        router.execute(address(usdce), amountIn, address(wxdai), 1, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_execute_revertsWhenTransmuterInventoryIsInsufficient() public {
        uint256 amountIn = 20_000_000;
        usdce.mint(user, amountIn);
        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](1);
        legs[0] = _transmuteCurveLeg(amountIn, 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouter.TransmuterInventoryInsufficient.selector);
        router.execute(address(usdce), amountIn, address(wxdai), 1, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_execute_revertsWhenLegSumDoesNotMatchAmountIn() public {
        uint256 amountIn = 100_000;
        usdce.mint(user, amountIn);
        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](1);
        legs[0] = _v3Leg(99_999, address(usdce), address(wxdai), 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouter.InvalidLegSum.selector);
        router.execute(address(usdce), amountIn, address(wxdai), 1, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_execute_revertsWhenV3PathStartsAtWrongToken() public {
        uint256 amountIn = 100_000;
        usdce.mint(user, amountIn);
        GnosisAggregationRouter.Leg[] memory legs = new GnosisAggregationRouter.Leg[](1);
        legs[0] = _v3Leg(amountIn, address(usdc), address(wxdai), 0);

        vm.startPrank(user);
        usdce.approve(address(router), amountIn);
        vm.expectRevert(GnosisAggregationRouter.PathEndpointMismatch.selector);
        router.execute(address(usdce), amountIn, address(wxdai), 1, recipient, block.timestamp + 1, legs);
        vm.stopPrank();
    }

    function test_constructor_revertsWhenDependencyHasNoCode() public {
        bytes32[] memory allowed = new bytes32[](0);

        vm.expectRevert(GnosisAggregationRouter.DependencyNoCode.selector);
        new GnosisAggregationRouter(address(0xBEEF), address(curve), address(transmuter), allowed);

        vm.expectRevert(GnosisAggregationRouter.DependencyNoCode.selector);
        new GnosisAggregationRouter(address(v3), address(0xBEEF), address(transmuter), allowed);

        vm.expectRevert(GnosisAggregationRouter.DependencyNoCode.selector);
        new GnosisAggregationRouter(address(v3), address(curve), address(0xBEEF), allowed);
    }

    function _v3Leg(uint256 amountIn, address tokenIn, address tokenOut, uint256 amountOutMinimum)
        internal
        pure
        returns (GnosisAggregationRouter.Leg memory leg)
    {
        leg.amountIn = amountIn;
        leg.steps = new GnosisAggregationRouter.Step[](1);
        bytes memory path = abi.encodePacked(tokenIn, FEE_LOW, tokenOut);
        leg.steps[0] = GnosisAggregationRouter.Step({
            stepType: GnosisAggregationRouter.StepType.V3, data: abi.encode(path, amountOutMinimum)
        });
    }

    function _transmuteCurveLeg(uint256 amountIn, uint256 curveMinOut)
        internal
        view
        returns (GnosisAggregationRouter.Leg memory leg)
    {
        (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools) = _curveUsdcToWxdai();

        leg.amountIn = amountIn;
        leg.steps = new GnosisAggregationRouter.Step[](2);
        leg.steps[0] = GnosisAggregationRouter.Step({
            stepType: GnosisAggregationRouter.StepType.Transmute,
            data: abi.encode(GnosisAggregationRouter.TransmuteDirection.UsdceToUsdc)
        });
        leg.steps[1] = GnosisAggregationRouter.Step({
            stepType: GnosisAggregationRouter.StepType.Curve, data: abi.encode(route, swapParams, pools, curveMinOut)
        });
    }

    function _unallowedTransmuteCurveLeg(uint256 amountIn)
        internal
        view
        returns (GnosisAggregationRouter.Leg memory leg)
    {
        (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools) = _curveUsdcToWxdai();
        route[1] = address(0x9999);

        leg.amountIn = amountIn;
        leg.steps = new GnosisAggregationRouter.Step[](2);
        leg.steps[0] = GnosisAggregationRouter.Step({
            stepType: GnosisAggregationRouter.StepType.Transmute,
            data: abi.encode(GnosisAggregationRouter.TransmuteDirection.UsdceToUsdc)
        });
        leg.steps[1] = GnosisAggregationRouter.Step({
            stepType: GnosisAggregationRouter.StepType.Curve, data: abi.encode(route, swapParams, pools, uint256(0))
        });
    }

    function _curveUsdcToWxdai()
        internal
        view
        returns (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools)
    {
        route[0] = address(usdc);
        route[1] = CURVE_POOL;
        route[2] = address(wxdai);
        swapParams[0] = [uint256(1), uint256(0), uint256(1), uint256(1), uint256(3)];
        pools;
    }
}
