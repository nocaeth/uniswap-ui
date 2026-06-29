import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { TradingApi } from '@universe/api'

const WXDAI = '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'
const SDAI = '0xaf204776c7245bF4147c2612BF6e5972Ee483701'
const USDCE = '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0'
const EURE = '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430'
const GBPE_V2 = '0x8E34bfEC4f6Eb781f9743D9b4af99CD23F9b7053'
const GBPE_V1 = '0x5Cb9073902F2035222B9749F8fB0c9BFe5527108'
const WETH = '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1'
const ZAP = '0x1234567890123456789012345678901234567890'
const NATIVE = '0x0000000000000000000000000000000000000000'
const RANDOM_TOKEN = '0x3333333333333333333333333333333333333333'
const SWAPPER = '0x1111111111111111111111111111111111111111'

// Enable the (env-gated) zap with a deterministic address + counterparty set.
vi.mock('uniswap/src/features/transactions/swap/services/gnosisRouter/constants', () => ({
  GNOSIS_WXDAI: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
  GNOSIS_SDAI: '0xaf204776c7245bF4147c2612BF6e5972Ee483701',
  GNOSIS_SDAI_ADAPTER_ADDRESS: '0xD499b51fcFc66bd31248ef4b28d656d67E591A94',
  GNOSIS_SDAI_ZAP_ADDRESS: '0x1234567890123456789012345678901234567890',
  GNOSIS_SDAI_ZAP_COUNTERPARTIES: [
    '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0',
    '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430',
    '0x8E34bfEC4f6Eb781f9743D9b4af99CD23F9b7053',
    '0x5Cb9073902F2035222B9749F8fB0c9BFe5527108',
    '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1',
  ],
}))

import {
  buildGnosisSdaiZapTransaction,
  encodeV3PathFromRoute,
  getGnosisSdaiZapApprovalSpender,
  getGnosisSdaiZapEligibility,
  GNOSIS_SDAI_ZAP_QUOTE_ID,
  GnosisSdaiZapDirection,
  isKnownGnosisSdaiZapCounterparty,
  isGnosisSdaiZapEnabled,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiZap'

const EXACT_INPUT = TradingApi.TradeType.EXACT_INPUT
const EXACT_OUTPUT = TradingApi.TradeType.EXACT_OUTPUT

function pool(tokenIn: string, tokenOut: string, fee: number): TradingApi.V3PoolInRoute {
  return {
    type: 'v3-pool',
    address: '0x0000000000000000000000000000000000000000',
    tokenIn: { address: tokenIn, chainId: 100 as unknown as TradingApi.ChainId, symbol: 'X', decimals: '18' },
    tokenOut: { address: tokenOut, chainId: 100 as unknown as TradingApi.ChainId, symbol: 'Y', decimals: '18' },
    fee: String(fee),
    liquidity: '0',
    sqrtRatioX96: '0',
    tickCurrent: '0',
    amountIn: '0',
    amountOut: '0',
  } as unknown as TradingApi.V3PoolInRoute
}

function zapQuote(overrides: Partial<TradingApi.ClassicQuote>): TradingApi.ClassicQuote {
  return {
    chainId: 100 as unknown as TradingApi.ChainId,
    swapper: SWAPPER,
    input: { token: WXDAI, amount: '1000' },
    output: { token: USDCE, amount: '990', recipient: SWAPPER },
    tradeType: EXACT_INPUT,
    slippage: 0.5,
    route: [[pool(SDAI, EURE, 500), pool(EURE, USDCE, 100)]],
    routeString: 'sDAI-zap',
    quoteId: GNOSIS_SDAI_ZAP_QUOTE_ID,
    priceImpact: 0.1,
    portionBips: 0,
    ...overrides,
  } as TradingApi.ClassicQuote
}

const zapAbi = new Interface([
  'function depositAndSwap(uint256 amountIn, bytes path, uint256 amountOutMinimum, address recipient, uint256 deadline) payable returns (uint256)',
  'function swapAndRedeem(address tokenIn, uint256 amountIn, bytes path, uint256 amountOutMinimum, address recipient, bool toNative, uint256 deadline) returns (uint256)',
])

describe('sdaiZap eligibility', () => {
  it('is enabled when a zap address is configured', () => {
    expect(isGnosisSdaiZapEnabled()).toBe(true)
  })

  it('routes WXDAI/native -> counterparty as deposit-and-swap', () => {
    expect(getGnosisSdaiZapEligibility({ tokenIn: WXDAI, tokenOut: USDCE, tradeType: EXACT_INPUT })).toBe(
      GnosisSdaiZapDirection.DepositAndSwap,
    )
    expect(getGnosisSdaiZapEligibility({ tokenIn: NATIVE, tokenOut: EURE, tradeType: EXACT_INPUT })).toBe(
      GnosisSdaiZapDirection.DepositAndSwap,
    )
  })

  it('is not eligible for tokens outside the curated counterparty set (no eager probing)', () => {
    // RANDOM_TOKEN is not in GNOSIS_SDAI_ZAP_COUNTERPARTIES — both directions must return undefined
    // to avoid wasted sDAI-cluster pool discovery on pairs that can never win through the zap.
    expect(
      getGnosisSdaiZapEligibility({ tokenIn: WXDAI, tokenOut: RANDOM_TOKEN, tradeType: EXACT_INPUT }),
    ).toBeUndefined()
    expect(
      getGnosisSdaiZapEligibility({ tokenIn: RANDOM_TOKEN, tokenOut: WXDAI, tradeType: EXACT_INPUT }),
    ).toBeUndefined()
  })

  it('routes counterparty -> WXDAI/native as swap-and-redeem', () => {
    expect(getGnosisSdaiZapEligibility({ tokenIn: WETH, tokenOut: WXDAI, tradeType: EXACT_INPUT })).toBe(
      GnosisSdaiZapDirection.SwapAndRedeem,
    )
    expect(getGnosisSdaiZapEligibility({ tokenIn: USDCE, tokenOut: NATIVE, tradeType: EXACT_INPUT })).toBe(
      GnosisSdaiZapDirection.SwapAndRedeem,
    )
  })

  it('is not eligible for exact-output, non-counterparty pairs, or sDAI (adapter handles it)', () => {
    expect(getGnosisSdaiZapEligibility({ tokenIn: WXDAI, tokenOut: USDCE, tradeType: EXACT_OUTPUT })).toBeUndefined()
    expect(getGnosisSdaiZapEligibility({ tokenIn: USDCE, tokenOut: EURE, tradeType: EXACT_INPUT })).toBeUndefined()
    expect(getGnosisSdaiZapEligibility({ tokenIn: WXDAI, tokenOut: SDAI, tradeType: EXACT_INPUT })).toBeUndefined()
  })

  it('documents GBPe as a known zap counterparty', () => {
    expect(isKnownGnosisSdaiZapCounterparty(GBPE_V2)).toBe(true)
    expect(isKnownGnosisSdaiZapCounterparty(GBPE_V1)).toBe(true)
  })

  it('approval spender is the zap for ERC20 input, none for native input', () => {
    expect(getGnosisSdaiZapApprovalSpender({ tokenIn: WXDAI, tokenOut: USDCE, tradeType: EXACT_INPUT })).toBe(ZAP)
    expect(getGnosisSdaiZapApprovalSpender({ tokenIn: USDCE, tokenOut: WXDAI, tradeType: EXACT_INPUT })).toBe(ZAP)
    expect(
      getGnosisSdaiZapApprovalSpender({ tokenIn: NATIVE, tokenOut: USDCE, tradeType: EXACT_INPUT }),
    ).toBeUndefined()
    expect(getGnosisSdaiZapApprovalSpender({ tokenIn: USDCE, tokenOut: EURE, tradeType: EXACT_INPUT })).toBeUndefined()
  })
})

describe('encodeV3PathFromRoute', () => {
  it('packs token|fee|token|fee|token', () => {
    const path = encodeV3PathFromRoute([pool(SDAI, EURE, 500), pool(EURE, USDCE, 100)])
    const expected =
      '0x' +
      SDAI.toLowerCase().slice(2) +
      (500).toString(16).padStart(6, '0') +
      EURE.toLowerCase().slice(2) +
      (100).toString(16).padStart(6, '0') +
      USDCE.toLowerCase().slice(2)
    expect(path).toBe(expected)
  })
})

describe('buildGnosisSdaiZapTransaction', () => {
  it('returns undefined for a non-zap quote', () => {
    expect(buildGnosisSdaiZapTransaction({ quote: zapQuote({ quoteId: 'gnosis-local' }) })).toBeUndefined()
  })

  it('builds depositAndSwap for WXDAI input (no value, path starts at sDAI)', () => {
    const tx = buildGnosisSdaiZapTransaction({ quote: zapQuote({}), deadline: 1000 })
    expect(tx?.to).toBe(ZAP)
    expect(tx?.value).toBe('0x0')
    const decoded = zapAbi.decodeFunctionData('depositAndSwap', tx!.data as string)
    expect(decoded['amountIn'].toString()).toBe('1000')
    expect((decoded['path'] as string).toLowerCase().startsWith('0x' + SDAI.toLowerCase().slice(2))).toBe(true)
    // 0.5% slippage floor on 990 -> 985 (canonical mul(BIPS_BASE)/(BIPS_BASE+bips))
    expect(decoded['amountOutMinimum'].toString()).toBe(BigNumber.from(990).mul(10_000).div(10_050).toString())
    expect(decoded['recipient'].toLowerCase()).toBe(SWAPPER.toLowerCase())
  })

  it('keeps amountOutMinimum strictly positive even at 100% slippage (never a zero floor)', () => {
    const tx = buildGnosisSdaiZapTransaction({ quote: zapQuote({ slippage: 100 }) })
    const decoded = zapAbi.decodeFunctionData('depositAndSwap', tx!.data as string)
    // canonical floor at 100% = 990 * 10000 / 20000 = 495, never 0
    expect(decoded['amountOutMinimum'].toString()).toBe(BigNumber.from(990).mul(10_000).div(20_000).toString())
    expect(BigNumber.from(decoded['amountOutMinimum']).gt(0)).toBe(true)
  })

  it('builds depositAndSwap for native xDAI input (value carries amount, amountIn=0)', () => {
    const tx = buildGnosisSdaiZapTransaction({ quote: zapQuote({ input: { token: NATIVE, amount: '1000' } }) })
    const decoded = zapAbi.decodeFunctionData('depositAndSwap', tx!.data as string)
    expect(decoded['amountIn'].toString()).toBe('0')
    expect(BigNumber.from(tx?.value).toString()).toBe('1000')
  })

  it('builds swapAndRedeem for WXDAI output (toNative=false)', () => {
    const quote = zapQuote({
      input: { token: USDCE, amount: '1000' },
      output: { token: WXDAI, amount: '990', recipient: SWAPPER },
      route: [[pool(USDCE, EURE, 100), pool(EURE, SDAI, 500)]],
    })
    const tx = buildGnosisSdaiZapTransaction({ quote })
    const decoded = zapAbi.decodeFunctionData('swapAndRedeem', tx!.data as string)
    expect(decoded['tokenIn'].toLowerCase()).toBe(USDCE.toLowerCase())
    expect(decoded['toNative']).toBe(false)
    expect((decoded['path'] as string).toLowerCase().endsWith(SDAI.toLowerCase().slice(2))).toBe(true)
  })

  it('builds swapAndRedeem for native xDAI output (toNative=true)', () => {
    const quote = zapQuote({
      input: { token: USDCE, amount: '1000' },
      output: { token: NATIVE, amount: '990', recipient: SWAPPER },
      route: [[pool(USDCE, EURE, 100), pool(EURE, SDAI, 500)]],
    })
    const tx = buildGnosisSdaiZapTransaction({ quote })
    const decoded = zapAbi.decodeFunctionData('swapAndRedeem', tx!.data as string)
    expect(decoded['toNative']).toBe(true)
  })
})
