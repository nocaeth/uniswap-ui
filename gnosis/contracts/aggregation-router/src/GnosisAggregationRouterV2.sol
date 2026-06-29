// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {ICurveRouterNg, IUSDCTransmuter, IV3SwapRouter} from "./GnosisAggregationRouter.sol";

/// @title GnosisAggregationRouterV2
/// @notice Exact-input, ownerless Gnosis router for composing Uniswap V3, Curve Router NG, and the
/// USDC transmuter in one atomic transaction.
///
/// V2 deliberately keeps the same closed action surface as V1: every step targets an immutable
/// dependency and final slippage is enforced by measuring the router's final tokenOut balance delta.
/// Unlike V1, Curve routes are not constructor-allowlisted. Any route accepted by the configured
/// immutable Curve Router NG may be executed.
contract GnosisAggregationRouterV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum StepType {
        V3,
        Curve,
        Transmute
    }

    enum TransmuteDirection {
        UsdcToUsdce,
        UsdceToUsdc
    }

    struct Step {
        StepType stepType;
        bytes data;
    }

    struct Leg {
        uint256 amountIn;
        Step[] steps;
    }

    IV3SwapRouter public immutable swapRouter;
    ICurveRouterNg public immutable curveRouter;
    IUSDCTransmuter public immutable usdcTransmuter;
    address public immutable USDC;
    address public immutable USDCE;

    event AggregationExecuted(
        address indexed sender,
        address indexed recipient,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    error Expired();
    error ZeroAddress();
    error DependencyNoCode();
    error ZeroAmount();
    error ZeroRecipient();
    error SameToken();
    error EmptyLegs();
    error EmptySteps();
    error InvalidLegSum();
    error UnsupportedStep();
    error MalformedPath();
    error PathEndpointMismatch();
    error CurveRouteEndpointMismatch();
    error TransmuterDisabled();
    error TransmuterInventoryInsufficient();
    error TransmuteEndpointMismatch();
    error InsufficientOutput();
    error NativeUnsupported();

    constructor(address swapRouter_, address curveRouter_, address usdcTransmuter_) {
        if (swapRouter_ == address(0) || curveRouter_ == address(0) || usdcTransmuter_ == address(0)) {
            revert ZeroAddress();
        }
        if (swapRouter_.code.length == 0 || curveRouter_.code.length == 0 || usdcTransmuter_.code.length == 0) {
            revert DependencyNoCode();
        }

        swapRouter = IV3SwapRouter(swapRouter_);
        curveRouter = ICurveRouterNg(curveRouter_);
        usdcTransmuter = IUSDCTransmuter(usdcTransmuter_);

        USDC = IUSDCTransmuter(usdcTransmuter_).USDC_ON_XDAI();
        USDCE = IUSDCTransmuter(usdcTransmuter_).USDC_E();
        if (USDC == address(0) || USDCE == address(0)) revert ZeroAddress();
    }

    receive() external payable {
        revert NativeUnsupported();
    }

    /// @notice Executes an exact-input, possibly split, plan. Every leg starts with `tokenIn`
    /// and must finish as `tokenOut`; the aggregate final output must clear `minAmountOut`.
    function execute(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline,
        Leg[] calldata legs
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroRecipient();
        if (legs.length == 0) revert EmptyLegs();

        uint256 legSum;
        for (uint256 i = 0; i < legs.length; i++) {
            legSum += legs[i].amountIn;
        }
        if (legSum != amountIn) revert InvalidLegSum();

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        for (uint256 i = 0; i < legs.length; i++) {
            (address currentToken, uint256 currentAmount) = _executeLeg(tokenIn, legs[i]);
            if (currentToken != tokenOut) revert PathEndpointMismatch();
            if (currentAmount == 0) revert InsufficientOutput();
        }

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
        if (amountOut < minAmountOut) revert InsufficientOutput();
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit AggregationExecuted(msg.sender, recipient, tokenIn, tokenOut, amountIn, amountOut);
    }

    function _executeLeg(address tokenIn, Leg calldata leg) private returns (address tokenOut, uint256 amountOut) {
        if (leg.amountIn == 0) revert ZeroAmount();
        if (leg.steps.length == 0) revert EmptySteps();

        tokenOut = tokenIn;
        amountOut = leg.amountIn;
        for (uint256 i = 0; i < leg.steps.length; i++) {
            Step calldata step = leg.steps[i];
            if (step.stepType == StepType.V3) {
                (tokenOut, amountOut) = _executeV3(tokenOut, amountOut, step.data);
            } else if (step.stepType == StepType.Curve) {
                (tokenOut, amountOut) = _executeCurve(tokenOut, amountOut, step.data);
            } else if (step.stepType == StepType.Transmute) {
                (tokenOut, amountOut) = _executeTransmute(tokenOut, amountOut, step.data);
            } else {
                revert UnsupportedStep();
            }
        }
    }

    function _executeV3(address tokenIn, uint256 amountIn, bytes calldata data)
        private
        returns (address tokenOut, uint256 amountOut)
    {
        (bytes memory path, uint256 amountOutMinimum) = abi.decode(data, (bytes, uint256));
        if (_firstToken(path) != tokenIn) revert PathEndpointMismatch();
        tokenOut = _lastToken(path);
        if (tokenOut == tokenIn) revert SameToken();

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        swapRouter.exactInput(
            IV3SwapRouter.ExactInputParams({
                path: path, recipient: address(this), amountIn: amountIn, amountOutMinimum: amountOutMinimum
            })
        );
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
        if (amountOut < amountOutMinimum) revert InsufficientOutput();
    }

    function _executeCurve(address tokenIn, uint256 amountIn, bytes calldata data)
        private
        returns (address tokenOut, uint256 amountOut)
    {
        (address[11] memory route, uint256[5][5] memory swapParams, address[5] memory pools, uint256 amountOutMinimum) =
            abi.decode(data, (address[11], uint256[5][5], address[5], uint256));

        if (route[0] != tokenIn) revert CurveRouteEndpointMismatch();

        tokenOut = _curveOutputToken(route);
        if (tokenOut == address(0) || tokenOut == tokenIn) revert CurveRouteEndpointMismatch();

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(address(curveRouter), amountIn);
        curveRouter.exchange(route, swapParams, amountIn, amountOutMinimum, pools, address(this));
        IERC20(tokenIn).forceApprove(address(curveRouter), 0);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
        if (amountOut < amountOutMinimum) revert InsufficientOutput();
    }

    function _executeTransmute(address tokenIn, uint256 amountIn, bytes calldata data)
        private
        returns (address tokenOut, uint256 amountOut)
    {
        TransmuteDirection direction = abi.decode(data, (TransmuteDirection));
        if (!usdcTransmuter.isEnabled()) revert TransmuterDisabled();

        if (direction == TransmuteDirection.UsdcToUsdce) {
            if (tokenIn != USDC) revert TransmuteEndpointMismatch();
            tokenOut = USDCE;
            uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
            IERC20(tokenIn).forceApprove(address(usdcTransmuter), amountIn);
            usdcTransmuter.deposit(amountIn);
            IERC20(tokenIn).forceApprove(address(usdcTransmuter), 0);
            amountOut = IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
        } else if (direction == TransmuteDirection.UsdceToUsdc) {
            if (tokenIn != USDCE) revert TransmuteEndpointMismatch();
            if (IERC20(USDC).balanceOf(address(usdcTransmuter)) < amountIn) {
                revert TransmuterInventoryInsufficient();
            }
            tokenOut = USDC;
            uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
            IERC20(tokenIn).forceApprove(address(usdcTransmuter), amountIn);
            usdcTransmuter.withdraw(amountIn);
            IERC20(tokenIn).forceApprove(address(usdcTransmuter), 0);
            amountOut = IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
        } else {
            revert UnsupportedStep();
        }

        if (amountOut == 0) revert InsufficientOutput();
    }

    /// @dev Curve route array is token, pool/zap, token, pool/zap, token... and stops at
    /// the first zero pool slot. Return the last token before that stop.
    function _curveOutputToken(address[11] memory route) private pure returns (address outputToken) {
        outputToken = route[0];
        for (uint256 i = 0; i < 5; i++) {
            address poolOrZap = route[i * 2 + 1];
            if (poolOrZap == address(0)) {
                return outputToken;
            }
            outputToken = route[i * 2 + 2];
        }
    }

    function _validatePath(bytes memory path) private pure {
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert MalformedPath();
    }

    function _firstToken(bytes memory path) private pure returns (address token) {
        _validatePath(path);
        assembly {
            token := shr(96, mload(add(path, 32)))
        }
    }

    function _lastToken(bytes memory path) private pure returns (address token) {
        _validatePath(path);
        uint256 n = path.length;
        assembly {
            token := shr(96, mload(add(add(path, 32), sub(n, 20))))
        }
    }
}
