import { TradingApi } from '@universe/api'
import { TradingApiClient } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { fetchGnosisQuote } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote'
import {
  createTradeRepository,
  type TradeRepository,
} from 'uniswap/src/features/transactions/swap/services/tradeService/tradeRepository'
import { logger } from 'utilities/src/logger/logger'

/**
 * Repositories
 *
 * This is where we _create_ instances of repositories that are used in services/hooks/etc.
 *
 * List of repositories:
 * - Trade Repository (formerly Quote Repository)
 */

/**
 * Trade Repository
 *
 * @returns A trade repository that can be used to fetch quotes from the trading API.
 */
export function getEVMTradeRepository(): TradeRepository {
  return createTradeRepository({
    // Gnosis has no Trading API support — quote it client-side via QuoterV2.
    // Every other chain continues to use the Trading API.
    fetchQuote: (params) =>
      Number(params.tokenInChainId) === UniverseChainId.Gnosis
        ? fetchGnosisQuote(params)
        : TradingApiClient.fetchQuote(params),
    fetchIndicativeQuote: (params) =>
      Number(params.tokenInChainId) === UniverseChainId.Gnosis
        ? fetchGnosisQuote({ ...params, type: params.type, slippageTolerance: undefined } as TradingApi.QuoteRequest, {
            indicative: true,
          })
        : TradingApiClient.fetchIndicativeQuote(params),
    logger,
  })
}
