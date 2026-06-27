// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SdaiZapRouter} from "../src/SdaiZapRouter.sol";

interface IWXDAI is IERC20 {
    function deposit() external payable;
}

/// Fork tests: run with `forge test --fork-url $RPC_GNOSIS`.
contract SdaiZapRouterTest is Test {
    // Gnosis (chain 100) addresses.
    address constant WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d;
    address constant SDAI = 0xaf204776c7245bF4147c2612BF6e5972Ee483701;
    address constant ADAPTER = 0xD499b51fcFc66bd31248ef4b28d656d67E591A94;
    address constant SWAP_ROUTER_02 = 0xc6D25285D5C5b62b7ca26D6092751A145D50e9Be;
    address constant EURE = 0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430;
    address constant USDCE = 0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0;

    uint24 constant FEE_LOWEST = 100;
    uint24 constant FEE_LOW = 500;

    SdaiZapRouter zap;
    address user = makeAddr("user");
    address recipient = makeAddr("recipient");

    function setUp() public {
        // Skip entirely when not run against a fork (no Gnosis state to read).
        if (WXDAI.code.length == 0) return;
        zap = new SdaiZapRouter(WXDAI, SDAI, ADAPTER, SWAP_ROUTER_02);
    }

    modifier onlyFork() {
        if (WXDAI.code.length == 0) {
            emit log("skipping: not a Gnosis fork (pass --fork-url $RPC_GNOSIS)");
            return;
        }
        _;
    }

    function _fundWxdai(address to, uint256 amount) internal {
        vm.deal(to, amount);
        vm.prank(to);
        IWXDAI(WXDAI).deposit{value: amount}();
    }

    // sDAI -> EURe -> USDC.e
    function _sdaiToUsdcePath() internal pure returns (bytes memory) {
        return abi.encodePacked(SDAI, FEE_LOW, EURE, FEE_LOWEST, USDCE);
    }

    // USDC.e -> EURe -> sDAI
    function _usdceToSdaiPath() internal pure returns (bytes memory) {
        return abi.encodePacked(USDCE, FEE_LOWEST, EURE, FEE_LOW, SDAI);
    }

    /// 50k WXDAI -> sDAI -> EURe -> USDC.e should clear the deep cluster (~49.8k USDC.e),
    /// far above the ~36.3k a direct WXDAI/USDC.e v3 swap yields at this size.
    function test_depositAndSwap_wxdai() public onlyFork {
        uint256 amountIn = 50_000 ether;
        _fundWxdai(user, amountIn);

        vm.startPrank(user);
        IERC20(WXDAI).approve(address(zap), amountIn);
        uint256 out = zap.depositAndSwap(amountIn, _sdaiToUsdcePath(), 0, recipient, block.timestamp + 1000);
        vm.stopPrank();

        emit log_named_decimal_uint("50k WXDAI -> USDC.e (zap)", out, 6);
        assertEq(IERC20(USDCE).balanceOf(recipient), out, "recipient got output");
        assertGt(out, 45_000e6, "beats the ~36.3k direct-WXDAI path by a wide margin");
        assertLt(out, 51_000e6, "no more than ~1:1 plus dust");
        // contract holds nothing afterwards
        assertEq(IERC20(WXDAI).balanceOf(address(zap)), 0);
        assertEq(IERC20(SDAI).balanceOf(address(zap)), 0);
    }

    /// 50k WXDAI -> sDAI -> EURe (the pair the pre-zap router lost to CoW by ~38%).
    /// Tells us whether the zap alone closes the EURe gap or Curve is still needed.
    function test_depositAndSwap_wxdai_to_eure() public onlyFork {
        uint256 amountIn = 50_000 ether;
        _fundWxdai(user, amountIn);

        bytes memory path = abi.encodePacked(SDAI, FEE_LOW, EURE);
        vm.startPrank(user);
        IERC20(WXDAI).approve(address(zap), amountIn);
        uint256 out = zap.depositAndSwap(amountIn, path, 0, recipient, block.timestamp + 1000);
        vm.stopPrank();

        emit log_named_decimal_uint("50k WXDAI -> EURe (zap)", out, 18);
        assertEq(IERC20(EURE).balanceOf(recipient), out);
    }

    /// Same path, native xDAI in.
    function test_depositAndSwap_nativeXdai() public onlyFork {
        uint256 amountIn = 50_000 ether;
        vm.deal(user, amountIn);

        vm.prank(user);
        uint256 out =
            zap.depositAndSwap{value: amountIn}(0, _sdaiToUsdcePath(), 0, recipient, block.timestamp + 1000);

        assertEq(IERC20(USDCE).balanceOf(recipient), out);
        assertGt(out, 45_000e6);
        assertEq(address(zap).balance, 0, "no native dust retained");
    }

    /// 50k USDC.e -> EURe -> sDAI -> WXDAI (redeem).
    function test_swapAndRedeem_toWxdai() public onlyFork {
        uint256 amountIn = 50_000e6;
        deal(USDCE, user, amountIn);

        vm.startPrank(user);
        IERC20(USDCE).approve(address(zap), amountIn);
        uint256 out =
            zap.swapAndRedeem(USDCE, amountIn, _usdceToSdaiPath(), 48_000 ether, recipient, false, block.timestamp + 1000);
        vm.stopPrank();

        emit log_named_decimal_uint("50k USDC.e -> WXDAI (zap)", out, 18);
        assertEq(IERC20(WXDAI).balanceOf(recipient), out, "recipient got WXDAI");
        assertGt(out, 48_000 ether);
        assertLt(out, 51_000 ether);
        assertEq(IERC20(SDAI).balanceOf(address(zap)), 0);
    }

    /// Same, but redeem to native xDAI.
    function test_swapAndRedeem_toNative() public onlyFork {
        uint256 amountIn = 50_000e6;
        deal(USDCE, user, amountIn);
        uint256 balBefore = recipient.balance;

        vm.startPrank(user);
        IERC20(USDCE).approve(address(zap), amountIn);
        uint256 out =
            zap.swapAndRedeem(USDCE, amountIn, _usdceToSdaiPath(), 48_000 ether, recipient, true, block.timestamp + 1000);
        vm.stopPrank();

        assertEq(recipient.balance - balBefore, out, "recipient got native xDAI");
        assertGt(out, 48_000 ether);
    }

    function test_revert_expired() public onlyFork {
        _fundWxdai(user, 1 ether);
        vm.startPrank(user);
        IERC20(WXDAI).approve(address(zap), 1 ether);
        vm.expectRevert(SdaiZapRouter.Expired.selector);
        zap.depositAndSwap(1 ether, _sdaiToUsdcePath(), 0, recipient, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_revert_badPathStart() public onlyFork {
        _fundWxdai(user, 1 ether);
        // path must start at sDAI; this one starts at USDC.e
        vm.startPrank(user);
        IERC20(WXDAI).approve(address(zap), 1 ether);
        vm.expectRevert(SdaiZapRouter.PathEndpointMismatch.selector);
        zap.depositAndSwap(1 ether, _usdceToSdaiPath(), 0, recipient, block.timestamp + 1000);
        vm.stopPrank();
    }

    function test_revert_malformedPath() public onlyFork {
        _fundWxdai(user, 1 ether);
        // 44 bytes: sDAI(20) + fee(3) + EURe(20) + 1 stray byte -> not (len-20)%23==0
        bytes memory badPath = abi.encodePacked(SDAI, FEE_LOW, EURE, uint8(1));
        vm.startPrank(user);
        IERC20(WXDAI).approve(address(zap), 1 ether);
        vm.expectRevert(SdaiZapRouter.MalformedPath.selector);
        zap.depositAndSwap(1 ether, badPath, 0, recipient, block.timestamp + 1000);
        vm.stopPrank();
    }

    function test_revert_nativeAmountMismatch() public onlyFork {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(SdaiZapRouter.NativeAmountMismatch.selector);
        zap.depositAndSwap{value: 1 ether}(1 ether, _sdaiToUsdcePath(), 0, recipient, block.timestamp + 1000);
    }

    function test_revert_zeroRecipient() public onlyFork {
        _fundWxdai(user, 1 ether);
        vm.startPrank(user);
        IERC20(WXDAI).approve(address(zap), 1 ether);
        vm.expectRevert(SdaiZapRouter.ZeroRecipient.selector);
        zap.depositAndSwap(1 ether, _sdaiToUsdcePath(), 0, address(0), block.timestamp + 1000);
        vm.stopPrank();
    }
}
