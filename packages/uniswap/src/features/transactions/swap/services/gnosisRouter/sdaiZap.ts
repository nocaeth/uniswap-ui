import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import type { TransactionRequest } from '@ethersproject/providers'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_SDAI_ZAP_ADDRESS,
  GNOSIS_SDAI_ZAP_COUNTERPARTIES,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { isGnosisNativeAddress } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZAP_DEADLINE_SECONDS = 60 * 30
const DEFAULT_SLIPPAGE_PERCENT = 0.5

export const GNOSIS_SDAI_ZAP_QUOTE_ID = 'gnosis-sdai-zap'
// Adapter deposit/redeem overhead added on top of the v3 sub-quote's gas estimate.
export const GNOSIS_SDAI_ZAP_ADAPTER_GAS = 180_000

export enum GnosisSdaiZapDirection {
  /** WXDAI | xDAI --(adapter)--> sDAI --(v3 path)--> tokenOut */
  DepositAndSwap = 'deposit-and-swap',
  /** tokenIn --(v3 path)--> sDAI --(adapter)--> WXDAI | xDAI */
  SwapAndRedeem = 'swap-and-redeem',
}

// Mirrors SdaiZapRouter.sol. exactInput-only, plain ERC20 approvals (no Permit2).
const zapInterface = new Interface([
  'function depositAndSwap(uint256 amountIn, bytes path, uint256 amountOutMinimum, address recipient, uint256 deadline) payable returns (uint256)',
  'function swapAndRedeem(address tokenIn, uint256 amountIn, bytes path, uint256 amountOutMinimum, address recipient, bool toNative, uint256 deadline) returns (uint256)',
])

function isGnosisAddressEqual(a: string | undefined, b: string): boolean {
  if (!a) {
    return false
  }
  return areAddressesEqual({
    addressInput1: { address: a, chainId: UniverseChainId.Gnosis },
    addressInput2: { address: b, chainId: UniverseChainId.Gnosis },
  })
}

/** True once a non-zero SdaiZapRouter address is configured (env). */
export function isGnosisSdaiZapEnabled(): boolean {
  return !isGnosisAddressEqual(GNOSIS_SDAI_ZAP_ADDRESS, ZERO_ADDRESS)
}

function isWxdaiOrNative(address: string | undefined): boolean {
  return isGnosisNativeAddress(address) || isGnosisAddressEqual(address, GNOSIS_WXDAI)
}

function isZapCounterparty(address: string | undefined): boolean {
  return GNOSIS_SDAI_ZAP_COUNTERPARTIES.some((counterparty) => isGnosisAddressEqual(address, counterparty))
}

/**
 * Whether a swap should route through the sDAI zap, and in which direction. Eligible only for
 * EXACT_INPUT (the contract is exact-input only) between WXDAI/xDAI and a curated counterparty, and
 * only while the zap is configured. This is the SINGLE source of truth shared by the quoter (which
 * produces the zap quote) and the approval hook (which points the ERC20 approval at the zap), so the
 * two can never disagree about whether a given swap uses the zap.
 */
export function getGnosisSdaiZapEligibility(args: {
  tokenIn: string | undefined
  tokenOut: string | undefined
  tradeType: TradingApi.TradeType
}): GnosisSdaiZapDirection | undefined {
  if (!isGnosisSdaiZapEnabled() || args.tradeType !== TradingApi.TradeType.EXACT_INPUT) {
    return undefined
  }
  if (isWxdaiOrNative(args.tokenIn) && isZapCounterparty(args.tokenOut)) {
    return GnosisSdaiZapDirection.DepositAndSwap
  }
  if (isZapCounterparty(args.tokenIn) && isWxdaiOrNative(args.tokenOut)) {
    return GnosisSdaiZapDirection.SwapAndRedeem
  }
  return undefined
}

export function isGnosisSdaiZapQuote(quote: TradingApi.ClassicQuote): boolean {
  return quote.quoteId === GNOSIS_SDAI_ZAP_QUOTE_ID
}

/**
 * The ERC20 the user must approve to the zap, or undefined when no approval is needed (native xDAI
 * input) or the swap is not a zap swap. Uses the same eligibility as the quoter so the spender always
 * matches the route that will actually execute.
 */
export function getGnosisSdaiZapApprovalSpender(args: {
  tokenIn: string | undefined
  tokenOut: string | undefined
  tradeType: TradingApi.TradeType
}): string | undefined {
  const direction = getGnosisSdaiZapEligibility(args)
  if (!direction || isGnosisNativeAddress(args.tokenIn)) {
    return undefined
  }
  return GNOSIS_SDAI_ZAP_ADDRESS
}

/** Packs a V3 path (token(20)|fee(3)|token(20)…) from a quote sub-route's per-hop pools. */
export function encodeV3PathFromRoute(pools: readonly TradingApi.V3PoolInRoute[]): string {
  let path = ''
  pools.forEach((pool, i) => {
    if (i === 0) {
      path += (pool.tokenIn?.address ?? '').toLowerCase().replace('0x', '')
    }
    path += Number(pool.fee).toString(16).padStart(6, '0')
    path += (pool.tokenOut?.address ?? '').toLowerCase().replace('0x', '')
  })
  return `0x${path}`
}

function applySlippageFloor(amount: BigNumber, slippagePercent: number | undefined): BigNumber {
  const pct = slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT
  const bips = Math.max(0, Math.round(pct * 100))
  return amount.mul(10_000 - bips).div(10_000)
}

/**
 * Builds the SdaiZapRouter transaction for a zap quote, or undefined if the quote is not a zap quote.
 * `depositAndSwap` for WXDAI/xDAI input, `swapAndRedeem` for WXDAI/xDAI output. The v3 `path` is
 * reconstructed from the quote's (single) sub-route, and `amountOutMinimum` from the quoted output
 * and the quote's slippage.
 */
export function buildGnosisSdaiZapTransaction(args: {
  quote: TradingApi.ClassicQuote
  deadline?: number
}): TransactionRequest | undefined {
  const { quote } = args
  if (!isGnosisSdaiZapQuote(quote)) {
    return undefined
  }
  if (!isGnosisSdaiZapEnabled()) {
    throw new Error(
      'GNOSIS_SDAI_ZAP_ADDRESS is not set. Deploy SdaiZapRouter and set REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS (see gnosis/contracts/sdai-zap/README.md).',
    )
  }

  const subRoute = quote.route?.[0]
  const tokenIn = quote.input?.token
  const tokenOut = quote.output?.token
  if (!subRoute || !subRoute.length || !quote.input?.amount || !quote.output?.amount || !tokenIn || !tokenOut) {
    return undefined
  }

  const path = encodeV3PathFromRoute(subRoute)
  const recipient = quote.output.recipient ?? quote.swapper ?? ZERO_ADDRESS
  const amountIn = BigNumber.from(quote.input.amount)
  const amountOutMinimum = applySlippageFloor(BigNumber.from(quote.output.amount), quote.slippage)
  const deadline = (args.deadline ?? Math.floor(Date.now() / 1000) + ZAP_DEADLINE_SECONDS).toString()
  const nativeIn = isGnosisNativeAddress(tokenIn)
  const nativeOut = isGnosisNativeAddress(tokenOut)

  let data: string
  let value = '0x0'
  if (isWxdaiOrNative(tokenIn)) {
    data = zapInterface.encodeFunctionData('depositAndSwap', [
      nativeIn ? BigNumber.from(0) : amountIn,
      path,
      amountOutMinimum,
      recipient,
      deadline,
    ])
    value = nativeIn ? amountIn.toHexString() : '0x0'
  } else {
    data = zapInterface.encodeFunctionData('swapAndRedeem', [
      tokenIn,
      amountIn,
      path,
      amountOutMinimum,
      recipient,
      nativeOut,
      deadline,
    ])
  }

  return {
    to: GNOSIS_SDAI_ZAP_ADDRESS,
    data,
    value,
    from: quote.swapper,
    chainId: UniverseChainId.Gnosis,
  }
}
