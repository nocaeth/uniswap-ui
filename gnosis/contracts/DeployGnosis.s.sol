// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Drop this into the official Uniswap/universal-router repo at
//   script/deployParameters/DeployGnosis.s.sol
// then deploy (see gnosis/contracts/README.md §2).
//
// VERSION — must match the app's SDK, NOT the newest UR. The app encodes swaps with
// @uniswap/universal-router-sdk@4.33.0, which depends on @uniswap/universal-router@2.1.0.
// That SDK encodes the V3_SWAP_EXACT_IN input with 5 fields
//   (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser).
// Pin the repo to the 2.1.0 release commit:
//   67553d8b067249dd7841d9d1b0eb2997b19d4bf9   (package.json version == 2.1.0)
// whose contracts are byte-identical to node_modules/@uniswap/universal-router@2.1.0
// (verified: RouterParameters.sol, V3SwapRouter.sol, UniversalRouter.sol, Dispatcher.sol).
//
// DO NOT use the previously deployed commit cb222d3 ("UR 2.1.1"): it added a 6th field
// `uint256[] minHopPriceX36` to V3_SWAP_EXACT_IN, so it read the SDK's 5-field input out of
// bounds and reverted SliceOutOfBounds() on EVERY swap (selector 0x3b99b53d). That is the bug
// this redeploy fixes. (cb222d3's RouterParameters also had an 11th field,
// permissionsAdapterFactory, which does NOT exist in 2.1.0 — hence the 10 fields below.)
//
// Gnosis is V3-only: V2 and V4 fields are address(0)/bytes32(0); the base script's
// mapUnsupported() routes those to a freshly deployed UnsupportedProtocol stub, so any
// V2/V4 command reverts cleanly instead of hitting a wrong address.

import {DeployUniversalRouter} from '../DeployUniversalRouter.s.sol';
import {RouterParameters} from 'contracts/types/RouterParameters.sol';

contract DeployGnosis is DeployUniversalRouter {
    function setUp() public override {
        params = RouterParameters({
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3, // canonical (deployed on Gnosis)
            weth9: 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d, // WXDAI (= WETH9 on Gnosis)
            v2Factory: address(0), // no Uniswap V2 on Gnosis -> mapped to UnsupportedProtocol
            v3Factory: 0xe32F7dD7e3f098D518ff19A22d5f028e076489B1,
            pairInitCodeHash: bytes32(0), // V2 unused
            // standard Uniswap V3 pool init code hash — verified on-chain via CREATE2
            // against the real USDC.e/WXDAI(0.01%) pool 0xf5E40cC12f69121B0329c256A99F4ab3ebDfAA2E
            poolInitCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
            v4PoolManager: address(0), // no Uniswap V4 on Gnosis -> mapped to UnsupportedProtocol
            v3NFTPositionManager: 0xAE8fbE656a77519a7490054274910129c9244FA3,
            v4PositionManager: address(0), // no Uniswap V4 on Gnosis -> mapped to UnsupportedProtocol
            spokePool: address(0) // Across bridging unused -> mapped to UnsupportedProtocol
        });

        // Leave unsupported = address(0): the base script deploys a fresh
        // UnsupportedProtocol stub and wires the zeroed protocols above to it.
    }
}
