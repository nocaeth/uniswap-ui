/* oxlint-disable no-bitwise -- decoding UniversalRouter command bytes is inherently bitwise */
import { Interface, defaultAbiCoder } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Percent, TradeType } from '@uniswap/sdk-core'
import { CommandType, RouterTradeAdapter, SwapRouter } from '@uniswap/universal-router-sdk'
import { encodeSqrtRatioX96 } from '@uniswap/v3-sdk'
import type { TradingApi } from '@universe/api'

/**
 * Spec §5/§6 "linchpin": a multi-sub-route quote.route flows through the EXISTING execution path
 * (RouterTradeAdapter.fromClassicQuote -> SwapRouter.swapCallParameters) into one UniversalRouter
 * transaction with one V3_SWAP_EXACT_IN per sub-route — no contract or adapter change. This is the
 * exact pair of calls gnosisSwapRepository makes; we decode the resulting calldata and assert the
 * command layout, including the K=2 nuance the SDK gates on (no aggregate SWEEP below 3 legs).
 */

// sqrtPriceX96 at tick 0 (price 1:1 for equal-decimal tokens); valid for the v3-sdk Pool constructor.
const Q96_TICK0 = encodeSqrtRatioX96(1, 1).toString()

const TOKEN_IN = '0xaaaa000000000000000000000000000000000001'
const TOKEN_OUT = '0xbbbb000000000000000000000000000000000002'
const RECIPIENT = '0xcccc000000000000000000000000000000000003'
const POOL1 = '0x1111000000000000000000000000000000000001'
const POOL2 = '0x2222000000000000000000000000000000000002'
const POOL3 = '0x3333000000000000000000000000000000000003'

function v3Pool(args: { address: string; fee: number; amountIn: string; amountOut: string }): TradingApi.V3PoolInRoute {
  return {
    type: 'v3-pool',
    address: args.address,
    tokenIn: { address: TOKEN_IN, chainId: 100, symbol: 'IN', decimals: '18' },
    tokenOut: { address: TOKEN_OUT, chainId: 100, symbol: 'OUT', decimals: '18' },
    fee: String(args.fee),
    liquidity: '1000000000000000000000',
    sqrtRatioX96: Q96_TICK0,
    tickCurrent: '0',
    amountIn: args.amountIn,
    amountOut: args.amountOut,
  } as unknown as TradingApi.V3PoolInRoute
}

/** Encode a quote.route through the production SDK pair and return it. */
function encodeRoute(route: TradingApi.V3PoolInRoute[][]): string {
  const routerTrade = RouterTradeAdapter.fromClassicQuote({
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    tradeType: TradeType.EXACT_INPUT,
    route: route as unknown as Parameters<typeof RouterTradeAdapter.fromClassicQuote>[0]['route'],
  })
  const { calldata } = SwapRouter.swapCallParameters(routerTrade, {
    slippageTolerance: new Percent(50, 10_000),
    recipient: RECIPIENT,
    deadlineOrPreviousBlockhash: '1700000000',
  })
  return calldata
}

/** Decode UniversalRouter execute(commands, inputs, deadline) and return the command bytes (flag masked). */
function commandBytes(calldata: string): number[] {
  const iface = new Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'])
  const decoded = iface.decodeFunctionData('execute', calldata)
  const commands: string = decoded[0]
  const hex = commands.slice(2)
  const out: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16) & 0x3f)
  }
  return out
}

describe('split-fill execution passthrough (universal-router-sdk)', () => {
  it('a 2-sub-route EXACT_INPUT quote encodes two V3_SWAP_EXACT_IN commands and no aggregate SWEEP', () => {
    const route = [
      [v3Pool({ address: POOL1, fee: 500, amountIn: '600', amountOut: '590' })],
      [v3Pool({ address: POOL2, fee: 3000, amountIn: '400', amountOut: '395' })],
    ]
    const cmds = commandBytes(encodeRoute(route))
    expect(cmds.filter((c) => c === CommandType.V3_SWAP_EXACT_IN)).toHaveLength(2)
    // At 2 legs the SDK sends each swap to the recipient with its own per-leg min-out (spec §3.3
    // as corrected): there is no router-custody aggregate sweep.
    expect(cmds).not.toContain(CommandType.SWEEP)
  })

  it('a 3-sub-route EXACT_INPUT quote adds a trailing SWEEP enforcing the aggregate min-out', () => {
    const route = [
      [v3Pool({ address: POOL1, fee: 500, amountIn: '500', amountOut: '495' })],
      [v3Pool({ address: POOL2, fee: 3000, amountIn: '300', amountOut: '297' })],
      [v3Pool({ address: POOL3, fee: 10000, amountIn: '200', amountOut: '198' })],
    ]
    const cmds = commandBytes(encodeRoute(route))
    expect(cmds.filter((c) => c === CommandType.V3_SWAP_EXACT_IN)).toHaveLength(3)
    expect(cmds).toContain(CommandType.SWEEP)
  })

  it('a single-sub-route quote still encodes exactly one V3_SWAP_EXACT_IN (back-compat)', () => {
    const route = [[v3Pool({ address: POOL1, fee: 500, amountIn: '1000', amountOut: '985' })]]
    const cmds = commandBytes(encodeRoute(route))
    expect(cmds.filter((c) => c === CommandType.V3_SWAP_EXACT_IN)).toHaveLength(1)
    expect(cmds).not.toContain(CommandType.SWEEP)
  })

  it('the 3-leg SWEEP amountMin covers the slippage-adjusted aggregate output (dust-leg sandwich safety)', () => {
    // Safety property for GNOSIS_MAX_SPLIT_LEGS=3: when the SDK routes via three sub-routes it
    // directs each V3_SWAP_EXACT_IN to the router (amountOutMinimum=0 per-command) and adds a
    // trailing SWEEP with an aggregate amountMin.  That aggregate MUST equal
    // slippage-adjusted(sum of ALL three legs), including the smallest.  If any single leg —
    // even a dust leg — is sandwiched to return zero, the total falls below the SWEEP floor and
    // the UniversalRouter reverts, so the user's input is never silently lost.
    //
    // Leg quoted outputs: 495 + 297 + 198 = 990.
    // At 0.5% slippage the SWEEP must enforce ≥ floor(990 * 9950 / 10000) = 985.
    const route = [
      [v3Pool({ address: POOL1, fee: 500, amountIn: '500', amountOut: '495' })],
      [v3Pool({ address: POOL2, fee: 3000, amountIn: '300', amountOut: '297' })],
      [v3Pool({ address: POOL3, fee: 10000, amountIn: '200', amountOut: '198' })],
    ]
    // encodeRoute uses Percent(50, 10_000) = 0.5% slippage tolerance.
    const calldata = encodeRoute(route)

    const iface = new Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'])
    const decoded = iface.decodeFunctionData('execute', calldata)
    const commands = decoded[0] as string
    const inputs = decoded[1] as string[]

    const hex = commands.slice(2)
    const cmdBytes: number[] = []
    for (let i = 0; i < hex.length; i += 2) {
      cmdBytes.push(parseInt(hex.slice(i, i + 2), 16) & 0x3f)
    }
    const sweepIdx = cmdBytes.indexOf(CommandType.SWEEP)
    expect(sweepIdx).toBeGreaterThanOrEqual(0)

    // SWEEP input is abi.encode(address token, address recipient, uint160 amountMin).
    // Decoded as uint256 (ABI pads uint160 to 32 bytes identically).
    const [, , sweepAmountMin] = defaultAbiCoder.decode(['address', 'address', 'uint256'], inputs[sweepIdx]!)

    const totalOut = BigNumber.from(495 + 297 + 198) // 990
    const minWithSlippage = totalOut.mul(10_000 - 50).div(10_000) // 985 at 0.5%
    expect(BigNumber.from(sweepAmountMin).gte(minWithSlippage)).toBe(true)
  })
})
