// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";

/// @notice Gnosis Savings xDAI adapter (0xD499…). Pulls WXDAI / native xDAI from the
/// caller and mints sDAI to `receiver`, and burns sDAI to return WXDAI / native xDAI.
interface ISavingsXDaiAdapter {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function depositXDAI(address receiver) external payable returns (uint256 shares);
    function redeem(uint256 shares, address receiver) external returns (uint256 assets);
    function redeemXDAI(uint256 shares, address receiver) external returns (uint256 assets);
}

/// @notice Uniswap V3 SwapRouter02 (0xc6D2…). `exactInput` uses plain ERC20 approvals
/// (no Permit2) and has no deadline field — the deadline is enforced by this contract.
interface IV3SwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @title SdaiZapRouter
/// @notice Atomically bridges WXDAI / native xDAI through the sDAI ERC-4626 vault into (or
/// out of) a Uniswap V3 multi-hop, in a single transaction.
///
/// On Gnosis the deep stable/ETH v3 liquidity is centered on sDAI (sDAI/EURe, sDAI/wstETH),
/// while WXDAI's only direct v3 edge into that cluster is a shallow WXDAI/USDC.e pool — so
/// selling size in WXDAI suffers large price impact. WXDAI↔sDAI conversion via the savings
/// adapter is free and unbounded, but the stock UniversalRouter cannot call the vault
/// mid-route. This contract closes that gap:
///
///   depositAndSwap: WXDAI | xDAI --(adapter)--> sDAI --(v3 path)--> tokenOut
///   swapAndRedeem:  tokenIn --(v3 path)--> sDAI --(adapter)--> WXDAI | xDAI
///
/// It holds no funds between transactions: every call pulls, converts/swaps, and forwards
/// the output to `recipient`.
contract SdaiZapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable WXDAI;
    address public immutable SDAI;
    ISavingsXDaiAdapter public immutable adapter;
    IV3SwapRouter public immutable swapRouter;

    event ZapDepositAndSwap(
        address indexed sender,
        address indexed recipient,
        bool nativeInput,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );
    event ZapSwapAndRedeem(
        address indexed sender,
        address indexed recipient,
        address tokenIn,
        uint256 amountIn,
        bool nativeOutput,
        uint256 amountOut
    );

    error Expired();
    error ZeroRecipient();
    error ZeroAmount();
    error NativeAmountMismatch();
    error MalformedPath();
    error PathEndpointMismatch();
    error InsufficientOutput();

    constructor(address wxdai, address sdai, address adapter_, address swapRouter_) {
        require(wxdai != address(0) && sdai != address(0) && adapter_ != address(0) && swapRouter_ != address(0));
        WXDAI = wxdai;
        SDAI = sdai;
        adapter = ISavingsXDaiAdapter(adapter_);
        swapRouter = IV3SwapRouter(swapRouter_);
    }

    /// @notice WXDAI or native xDAI -> sDAI (savings adapter) -> tokenOut (V3 `path`).
    /// @param amountIn WXDAI amount to pull from the caller. MUST be 0 when sending native
    /// xDAI (`msg.value > 0`); the adapter then converts `msg.value`.
    /// @param path V3 path that MUST start at sDAI and end at the desired output token.
    /// @param amountOutMinimum Minimum output token amount (enforced by SwapRouter02).
    /// @param recipient Receiver of the output token.
    /// @param deadline Unix timestamp after which the call reverts.
    function depositAndSwap(
        uint256 amountIn,
        bytes calldata path,
        uint256 amountOutMinimum,
        address recipient,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (recipient == address(0)) revert ZeroRecipient();
        if (_firstToken(path) != SDAI) revert PathEndpointMismatch();

        uint256 shares;
        bool nativeInput = msg.value > 0;
        if (nativeInput) {
            if (amountIn != 0) revert NativeAmountMismatch();
            shares = adapter.depositXDAI{value: msg.value}(address(this));
        } else {
            if (amountIn == 0) revert ZeroAmount();
            IERC20(WXDAI).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(WXDAI).forceApprove(address(adapter), amountIn);
            shares = adapter.deposit(amountIn, address(this));
        }

        IERC20(SDAI).forceApprove(address(swapRouter), shares);
        amountOut = swapRouter.exactInput(
            IV3SwapRouter.ExactInputParams({
                path: path,
                recipient: recipient,
                amountIn: shares,
                amountOutMinimum: amountOutMinimum
            })
        );

        emit ZapDepositAndSwap(
            msg.sender, recipient, nativeInput, nativeInput ? msg.value : amountIn, _lastToken(path), amountOut
        );
    }

    /// @notice tokenIn (V3 `path`) -> sDAI -> WXDAI or native xDAI (savings adapter).
    /// @param tokenIn Input token pulled from the caller; MUST equal the path's first token.
    /// @param amountIn Amount of `tokenIn` to pull from the caller.
    /// @param path V3 path that MUST start at `tokenIn` and end at sDAI.
    /// @param amountOutMinimum Minimum WXDAI / xDAI returned (enforced after redeem).
    /// @param recipient Receiver of the WXDAI / xDAI output.
    /// @param toNative When true, returns native xDAI; otherwise WXDAI.
    /// @param deadline Unix timestamp after which the call reverts.
    function swapAndRedeem(
        address tokenIn,
        uint256 amountIn,
        bytes calldata path,
        uint256 amountOutMinimum,
        address recipient,
        bool toNative,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (recipient == address(0)) revert ZeroRecipient();
        if (amountIn == 0) revert ZeroAmount();
        if (_firstToken(path) != tokenIn || _lastToken(path) != SDAI) revert PathEndpointMismatch();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        uint256 shares = swapRouter.exactInput(
            IV3SwapRouter.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0 // final slippage enforced on the redeemed WXDAI/xDAI below
            })
        );

        IERC20(SDAI).forceApprove(address(adapter), shares);
        amountOut = toNative ? adapter.redeemXDAI(shares, recipient) : adapter.redeem(shares, recipient);
        if (amountOut < amountOutMinimum) revert InsufficientOutput();

        emit ZapSwapAndRedeem(msg.sender, recipient, tokenIn, amountIn, toNative, amountOut);
    }

    /// @dev Reverts unless `path` is a canonical Uniswap V3 path: token(20) + N×(fee(3) + token(20)),
    /// i.e. length >= 43 and (length - 20) % 23 == 0. Enforcing this keeps `_lastToken` byte-aligned
    /// with how SwapRouter02 decodes `tokenOut`, so the endpoint guards can't be satisfied by a
    /// misaligned path whose real output token differs.
    function _validatePath(bytes calldata path) private pure {
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert MalformedPath();
    }

    /// @dev First 20 bytes of a (validated) Uniswap V3 path, as an address.
    function _firstToken(bytes calldata path) private pure returns (address token) {
        _validatePath(path);
        assembly {
            token := shr(96, calldataload(path.offset))
        }
    }

    /// @dev Last 20 bytes of a (validated) Uniswap V3 path, as an address.
    function _lastToken(bytes calldata path) private pure returns (address token) {
        _validatePath(path);
        uint256 n = path.length;
        assembly {
            token := shr(96, calldataload(add(path.offset, sub(n, 20))))
        }
    }
}
