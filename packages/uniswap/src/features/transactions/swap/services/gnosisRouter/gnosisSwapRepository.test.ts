import { FeeAmount } from '@uniswap/v3-sdk'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_USDCE,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getGnosisRouterTradeTokenAddresses } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/gnosisSwapRepository'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis as unknown as TradingApi.ChainId
const NATIVE_XDAI_SENTINEL = '0x0000000000000000000000000000000000000000'

function token(address: string, symbol: string): TradingApi.TokenInRoute {
  return { address, symbol, chainId: GNOSIS_CHAIN_ID, decimals: '18' }
}

function quote(overrides: Partial<TradingApi.ClassicQuote> = {}): TradingApi.ClassicQuote {
  return {
    chainId: GNOSIS_CHAIN_ID,
    swapper: '0x1111111111111111111111111111111111111111',
    input: { token: GNOSIS_GBPE_V2, amount: '1000000000000000000' },
    output: { token: GNOSIS_USDCE, amount: '1000000', recipient: '0x1111111111111111111111111111111111111111' },
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
