import { TransactionRequest } from '@ethersproject/providers'
import { Percent, TradeType } from '@uniswap/sdk-core'
import { RouterTradeAdapter, SwapRouter } from '@uniswap/universal-router-sdk'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { GNOSIS_UNIVERSAL_ROUTER_ADDRESS } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import type {
  EVMSwapRepository,
  SwapData,
  SwapRequestParams,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/evmSwapRepository'

const DEFAULT_SLIPPAGE_PERCENT = 0.5
const DEADLINE_SECONDS = 60 * 30

/**
 * Builds the UniversalRouter swap transaction client-side for Gnosis, replacing the
 * Trading API `/swap` endpoint. Consumes the CLASSIC quote produced by
 * fetchGnosisQuote and encodes calldata via @uniswap/universal-router-sdk.
 */
export function createGnosisEVMSwapRepository(): EVMSwapRepository {
  return {
    fetchSwapData: async (params: SwapRequestParams): Promise<SwapData> => {
      const quote = params.quote as TradingApi.ClassicQuote

      if (GNOSIS_UNIVERSAL_ROUTER_ADDRESS === '0x0000000000000000000000000000000000000000') {
        throw new Error(
          'GNOSIS_UNIVERSAL_ROUTER_ADDRESS is not set. Deploy UniversalRouter and set REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS (see gnosis/contracts/README.md).',
        )
      }

      const tradeType =
        quote.tradeType === TradingApi.TradeType.EXACT_OUTPUT ? TradeType.EXACT_OUTPUT : TradeType.EXACT_INPUT

      const routerTrade = RouterTradeAdapter.fromClassicQuote({
        tokenIn: quote.input?.token ?? '',
        tokenOut: quote.output?.token ?? '',
        tradeType,
        // V3PoolInRoute shapes are structurally compatible across the api/sdk packages.
        route: quote.route as unknown as Parameters<typeof RouterTradeAdapter.fromClassicQuote>[0]['route'],
      })

      const slippagePercent = quote.slippage ?? DEFAULT_SLIPPAGE_PERCENT
      const deadline = (params.deadline ?? Math.floor(Date.now() / 1000) + DEADLINE_SECONDS).toString()

      const { calldata, value } = SwapRouter.swapCallParameters(routerTrade, {
        slippageTolerance: new Percent(Math.round(slippagePercent * 100), 10_000),
        recipient: quote.swapper ?? '',
        deadlineOrPreviousBlockhash: deadline,
      })

      const transaction: TransactionRequest = {
        to: GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
        data: calldata,
        value,
        from: quote.swapper,
        chainId: UniverseChainId.Gnosis,
      }

      return {
        requestId: 'gnosis-local',
        transactions: [transaction],
        gasFee: quote.gasFee ?? '0',
      }
    },
  }
}
