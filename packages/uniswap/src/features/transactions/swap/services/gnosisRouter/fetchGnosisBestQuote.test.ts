import type { DiscriminatedQuoteResponse } from '@universe/api'
import { TradingApi } from '@universe/api'
import { selectBestGnosisQuote } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisBestQuote'

function classicQuote(amountOut: string, quoteId: string): DiscriminatedQuoteResponse {
  return {
    requestId: quoteId,
    routing: TradingApi.Routing.CLASSIC,
    permitData: null,
    quote: {
      quoteId,
      output: { amount: amountOut },
    },
  } as DiscriminatedQuoteResponse
}

describe('selectBestGnosisQuote', () => {
  it('returns the Velora quote when exact-input output is better', () => {
    const betterVeloraQuote = veloraQuote('101')

    expect(
      selectBestGnosisQuote({
        localQuote: classicQuote('100', 'gnosis-local'),
        veloraQuote: betterVeloraQuote,
      }),
    ).toBe(betterVeloraQuote)
  })

  it('keeps the local quote when Velora is worse or missing', () => {
    const localQuote = classicQuote('100', 'gnosis-local')

    expect(selectBestGnosisQuote({ localQuote, veloraQuote: classicQuote('99', 'gnosis-velora') })).toBe(localQuote)
    expect(selectBestGnosisQuote({ localQuote })).toBe(localQuote)
  })
})

function veloraQuote(amountOut: string): DiscriminatedQuoteResponse {
  return classicQuote(amountOut, 'gnosis-velora')
}
