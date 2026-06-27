import { createPromiseClient } from '@connectrpc/connect'
import { DataApiService } from '@uniswap/client-data-api/dist/data/v1/api_connect'
import type { RestPriceClient, TokenIdentifier, TokenPriceData } from '@universe/prices'
import { createPriceKey } from '@universe/prices'
import { dataApiPostTransport } from 'uniswap/src/data/rest/base'

// Gnosis fork: GetTokenPrices is served by the self-hosted adapter, reached
// same-origin via the DataApiService transport (API_BASE_URL_V2_OVERRIDE).
// Uniswap's hosted entry gateway has no Gnosis (chain 100) price data.
const dataApiClient = createPromiseClient(DataApiService, dataApiPostTransport)

/**
 * Creates a RestPriceClient that uses DataApiService/GetTokenPrices.
 *
 * When preferQuotePrices is true, the backend returns TAPI quote prices.
 * Otherwise the request omits preferQuotePrices and the backend returns the
 * default remote price-service data.
 */
export function createRestPriceClient(options?: { preferQuotePrices?: boolean }): RestPriceClient {
  const preferQuotePrices = options?.preferQuotePrices === true
  const source: TokenPriceData['source'] = preferQuotePrices ? 'tapi_quote' : 'aurora_rest_fallback'

  return {
    async getTokenPrices(tokens: TokenIdentifier[]): Promise<Map<string, TokenPriceData>> {
      const response = await dataApiClient.getTokenPrices({
        tokens: tokens.map((t) => ({
          chainId: t.chainId,
          address: t.address.toLowerCase(),
        })),
        ...(preferQuotePrices ? { preferQuotePrices: true } : {}),
      })

      const result = new Map<string, TokenPriceData>()

      for (const tp of response.tokenPrices) {
        if (tp.priceUsd != null) {
          const key = createPriceKey(tp.chainId, tp.address)
          result.set(key, {
            price: tp.priceUsd,
            timestamp: tp.updatedAt ? new Date(tp.updatedAt).getTime() : Date.now(),
            source,
          })
        }
      }

      return result
    },
  }
}
