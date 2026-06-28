import type { TradingApi } from '@universe/api'
import { isWebApp } from '@universe/environment'
import type { SwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { isBridge, isClassic, isWrap } from 'uniswap/src/features/transactions/swap/utils/routing'

/**
 * Returns the sponsor metadata to display on the Network cost row, if any.
 * - Wallet-initiated swaps: the Trading API's quote carries the sponsor on
 *   `trade.quote.sponsorshipInfo.sponsor` when the swap is sponsored.
 * - Web-initiated swaps: NOCA is the displayed sponsor when the context
 *   indicates sponsorship
 *   (paymasterService set, or requestUniswapGasSponsorship === true).
 */
export function resolveSponsorMetadata(swapTxContext: SwapTxAndGasInfo): TradingApi.SponsorMetadata | undefined {
  if (isClassic(swapTxContext) || isBridge(swapTxContext) || isWrap(swapTxContext)) {
    const sponsor = swapTxContext.trade?.quote.sponsorshipInfo?.sponsorMetadata
    if (sponsor) {
      return sponsor
    }

    if (isWebApp && (swapTxContext.paymasterService || swapTxContext.requestUniswapGasSponsorship)) {
      return {
        name: 'NOCA',
        icon: '/favicon.png',
      }
    }
  }

  return undefined
}
