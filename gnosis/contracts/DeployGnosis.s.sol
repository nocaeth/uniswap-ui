// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Drop this into the official Uniswap/universal-router repo at
//   script/deployParameters/DeployGnosis.s.sol
// then deploy (see gnosis/contracts/README.md §2). Pin the repo to the commit whose
// RouterParameters struct matches the 11 fields below — verified against
//   universal-router @ cb222d358a2ea780feedee6990ff8a3c185301bf ("UR 2.1.1").
// This is the V4-capable UR line that @uniswap/universal-router-sdk's "2.0"/"2.1"
// command set targets (the app pins UniversalRouterVersion._2_0). A UR built from
// this commit + these params executed a real WXDAI->USDC.e swap on a Gnosis fork.
//
// Gnosis is V3-only: V2 and V4 fields are address(0)/bytes32(0); the base script's
// mapUnsupported() routes those to a freshly deployed UnsupportedProtocol stub, so
// any V2/V4 command reverts cleanly instead of hitting a wrong address.

import {DeployUniversalRouter} from '../DeployUniversalRouter.s.sol';
import {RouterParameters} from 'contracts/types/RouterParameters.sol';

contract DeployGnosis is DeployUniversalRouter {
    function setUp() public override {
        params = RouterParameters({
            permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3, // canonical (deployed on Gnosis)
            weth9: 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d, // WXDAI (= WETH9 on Gnosis)
            v2Factory: address(0), // no Uniswap V2 on Gnosis
            v3Factory: 0xe32F7dD7e3f098D518ff19A22d5f028e076489B1,
            pairInitCodeHash: bytes32(0), // V2 unused
            // standard Uniswap V3 pool init code hash — verified on-chain via CREATE2
            // against the real USDC.e/WXDAI(0.01%) pool 0xf5E40cC12f69121B0329c256A99F4ab3ebDfAA2E
            poolInitCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
            v4PoolManager: address(0), // no Uniswap V4 on Gnosis
            permissionsAdapterFactory: address(0), // permissioned pools disabled
            v3NFTPositionManager: 0xAE8fbE656a77519a7490054274910129c9244FA3,
            v4PositionManager: address(0), // no Uniswap V4 on Gnosis
            spokePool: address(0) // Across bridging unused
        });

        // Leave unsupported = address(0): the base script deploys a fresh
        // UnsupportedProtocol stub and wires the zeroed protocols above to it.
    }
}
