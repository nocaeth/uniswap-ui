import { Interface } from '@ethersproject/abi'
import { FeeAmount } from '@uniswap/v3-sdk'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { SDAI_ADAPTER_ABI } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_SDAI,
  GNOSIS_SDAI_ADAPTER_ADDRESS,
  GNOSIS_USDCE,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  buildGnosisSdaiAdapterTransaction,
  getGnosisRouterTradeTokenAddresses,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/gnosisSwapRepository'
import { GNOSIS_SDAI_ADAPTER_QUOTE_ID } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis as unknown as TradingApi.ChainId
const NATIVE_XDAI_SENTINEL = '0x0000000000000000000000000000000000000000'
const SWAPPER = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x3333333333333333333333333333333333333333'
const sdaiAdapterInterface = new Interface(SDAI_ADAPTER_ABI)

function token(address: string, symbol: string): TradingApi.TokenInRoute {
  return { address, symbol, chainId: GNOSIS_CHAIN_ID, decimals: '18' }
}

function quote(overrides: Partial<TradingApi.ClassicQuote> = {}): TradingApi.ClassicQuote {
  return {
    chainId: GNOSIS_CHAIN_ID,
    swapper: SWAPPER,
    input: { token: GNOSIS_GBPE_V2, amount: '1000000000000000000' },
    output: { token: GNOSIS_USDCE, amount: '1000000', recipient: SWAPPER },
    tradeType: TradingApi.TradeType.EXACT_INPUT,
    slippage: 0.5,
    quoteId: 'gnosis-local',
    gasUseEstimate: '100000',
    priceImpact: 0,
    portionBips: 0,
    route: [
      [
        {
          type: 'v3-pool',
          address: '0x2222222222222222222222222222222222222222',
          tokenIn: token(GNOSIS_GBPE_V1, 'GBPe'),
          tokenOut: token(GNOSIS_USDCE, 'USDC.e'),
          fee: String(FeeAmount.LOW),
          liquidity: '100',
          sqrtRatioX96: '79228162514264337593543950336',
          tickCurrent: '0',
          amountIn: '1000000000000000000',
          amountOut: '1000000',
        },
      ],
    ],
    routeString: '',
    ...overrides,
  }
}

function adapterQuote(overrides: Partial<TradingApi.ClassicQuote> = {}): TradingApi.ClassicQuote {
  return quote({
    input: { token: NATIVE_XDAI_SENTINEL, amount: '1000000000000000000' },
    output: { token: GNOSIS_SDAI, amount: '950000000000000000', recipient: RECIPIENT },
    route: [],
    routeString: 'sDAI adapter',
    quoteId: GNOSIS_SDAI_ADAPTER_QUOTE_ID,
    ...overrides,
  })
}

describe('getGnosisRouterTradeTokenAddresses', () => {
  it('uses concrete route boundary tokens for shared-state legacy liquidity', () => {
    expect(getGnosisRouterTradeTokenAddresses(quote())).toEqual({
      tokenIn: GNOSIS_GBPE_V1,
      tokenOut: GNOSIS_USDCE,
    })
  })

  it('preserves native xDAI sentinels for UniversalRouter wrap handling', () => {
    const basePool = quote().route?.[0]?.[0]
    if (!basePool) {
      throw new Error('Expected test quote to include a route pool')
    }

    expect(
      getGnosisRouterTradeTokenAddresses(
        quote({
          input: { token: NATIVE_XDAI_SENTINEL, amount: '1000000000000000000' },
          route: [
            [
              {
                ...basePool,
                tokenIn: token(GNOSIS_WXDAI, 'WXDAI'),
                tokenOut: token(GNOSIS_USDCE, 'USDC.e'),
              },
            ],
          ],
        }),
      ),
    ).toEqual({
      tokenIn: NATIVE_XDAI_SENTINEL,
      tokenOut: GNOSIS_USDCE,
    })
  })
})

describe('buildGnosisSdaiAdapterTransaction', () => {
  it('encodes native xDAI exact-input deposits through the adapter', () => {
    const tx = buildGnosisSdaiAdapterTransaction(adapterQuote())
    const decoded = sdaiAdapterInterface.decodeFunctionData('depositXDAI', tx?.data ?? '0x')

    expect(tx?.to).toBe(GNOSIS_SDAI_ADAPTER_ADDRESS)
    expect(tx?.from).toBe(SWAPPER)
    expect(tx?.chainId).toBe(UniverseChainId.Gnosis)
    expect(tx?.value?.toString()).toBe('1000000000000000000')
    expect(decoded[0]).toBe(RECIPIENT)
  })

  it('encodes WXDAI exact-output mints through the adapter', () => {
    const tx = buildGnosisSdaiAdapterTransaction(
      adapterQuote({
        input: { token: GNOSIS_WXDAI, amount: '1001000000000000000' },
        output: { token: GNOSIS_SDAI, amount: '1000000000000000000', recipient: RECIPIENT },
        tradeType: TradingApi.TradeType.EXACT_OUTPUT,
      }),
    )
    const decoded = sdaiAdapterInterface.decodeFunctionData('mint', tx?.data ?? '0x')

    expect(tx?.value).toBe('0x0')
    expect(decoded[0].toString()).toBe('1000000000000000000')
    expect(decoded[1]).toBe(RECIPIENT)
  })

  it('encodes sDAI exact-input native withdrawals through the adapter', () => {
    const tx = buildGnosisSdaiAdapterTransaction(
      adapterQuote({
        input: { token: GNOSIS_SDAI, amount: '1000000000000000000' },
        output: { token: NATIVE_XDAI_SENTINEL, amount: '1050000000000000000', recipient: RECIPIENT },
      }),
    )
    const decoded = sdaiAdapterInterface.decodeFunctionData('redeemXDAI', tx?.data ?? '0x')

    expect(tx?.to).toBe(GNOSIS_SDAI_ADAPTER_ADDRESS)
    expect(tx?.value).toBe('0x0')
    expect(decoded[0].toString()).toBe('1000000000000000000')
    expect(decoded[1]).toBe(RECIPIENT)
  })

  it('does not claim normal V3 quotes', () => {
    expect(buildGnosisSdaiAdapterTransaction(quote())).toBeUndefined()
  })

  it('rejects unsupported native xDAI exact-output deposits', () => {
    expect(() =>
      buildGnosisSdaiAdapterTransaction(
        adapterQuote({
          tradeType: TradingApi.TradeType.EXACT_OUTPUT,
          input: { token: NATIVE_XDAI_SENTINEL, amount: '1001000000000000000' },
          output: { token: GNOSIS_SDAI, amount: '1000000000000000000', recipient: RECIPIENT },
        }),
      ),
    ).toThrow('Exact-output native xDAI -> sDAI adapter swaps are not supported')
  })
})
