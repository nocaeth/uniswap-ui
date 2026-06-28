import { BigNumber } from '@ethersproject/bignumber'
import type { DiscriminatedQuoteResponse } from '@universe/api'
import { TradingApi } from '@universe/api'
import { fetchGnosisQuote } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote'
import {
  fetchGnosisVeloraQuote,
  withGnosisVeloraFallbackQuote,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/velora'

function getClassicExactInputOutputAmount(response: DiscriminatedQuoteResponse | undefined): BigNumber | undefined {
  if (response?.routing !== TradingApi.Routing.CLASSIC || !response.quote.output?.amount) {
    return undefined
  }

  return BigNumber.from(response.quote.output.amount)
}

export function selectBestGnosisQuote(args: {
  localQuote: DiscriminatedQuoteResponse
  veloraQuote?: DiscriminatedQuoteResponse
}): DiscriminatedQuoteResponse {
  const localOutput = getClassicExactInputOutputAmount(args.localQuote)
  const veloraOutput = getClassicExactInputOutputAmount(args.veloraQuote)
  if (!args.veloraQuote || !localOutput || !veloraOutput) {
    return args.localQuote
  }

  if (
    veloraOutput.gt(localOutput) &&
    args.veloraQuote.routing === TradingApi.Routing.CLASSIC &&
    args.localQuote.routing === TradingApi.Routing.CLASSIC
  ) {
    return withGnosisVeloraFallbackQuote(args.veloraQuote, args.localQuote.quote)
  }

  return args.localQuote
}

export async function fetchGnosisBestQuote(
  params: TradingApi.QuoteRequest & { isUSDQuote?: boolean },
): Promise<DiscriminatedQuoteResponse> {
  if (params.type !== TradingApi.TradeType.EXACT_INPUT || params.isUSDQuote) {
    return fetchGnosisQuote(params)
  }

  const [localResult, veloraResult] = await Promise.allSettled([
    fetchGnosisQuote(params),
    fetchGnosisVeloraQuote(params),
  ])

  const veloraQuote = veloraResult.status === 'fulfilled' ? veloraResult.value : undefined
  if (localResult.status === 'fulfilled') {
    return selectBestGnosisQuote({ localQuote: localResult.value, veloraQuote })
  }

  if (veloraQuote) {
    return veloraQuote
  }

  throw localResult.reason
}
