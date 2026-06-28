import { Percent } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { getNativeAddress } from 'uniswap/src/constants/addresses'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  getGnosisVeloraQuoteMetadata,
  getVeloraRouteLegs,
  isGnosisVeloraQuote,
  type VeloraRouteLeg,
  type VeloraSwap,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/velora'
import { Trade } from 'uniswap/src/features/transactions/swap/types/trade'
import { isClassic } from 'uniswap/src/features/transactions/swap/utils/routing'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'
import { buildCurrencyId } from 'uniswap/src/utils/currencyId'
import type { RoutingDiagramEntry, RoutingHop, RoutingProvider } from 'uniswap/src/utils/routingDiagram/types'

function isVeloraNativeToken(address: string): boolean {
  return areAddressesEqual({
    addressInput1: { address, chainId: UniverseChainId.Gnosis },
    addressInput2: { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', chainId: UniverseChainId.Gnosis },
  })
}

function currencyIdForVeloraToken(address: string): string {
  return buildCurrencyId(
    UniverseChainId.Gnosis,
    isVeloraNativeToken(address) ? getNativeAddress(UniverseChainId.Gnosis) : address,
  )
}

function getSwapExchangeLabel(swap: VeloraSwap): string {
  const exchanges = [...new Set(swap.swapExchanges.map((exchange) => exchange.exchange).filter(Boolean))]
  return exchanges.join(' + ') || 'Velora'
}

function getProtocolLabel(path: RoutingHop[]): string {
  const labels = [...new Set(path.map((hop) => (hop.type === 'genericHop' ? hop.name : 'Velora')))]
  return labels.length <= 2 ? labels.join(' + ') : 'Velora'
}

function getRoutePercent(leg: VeloraRouteLeg): Percent {
  return new Percent(Math.round(leg.percent * 100), 10_000)
}

function getFallbackPath(trade: Trade): RoutingHop[] {
  return [
    {
      type: 'genericHop',
      inputCurrencyId: buildCurrencyId(UniverseChainId.Gnosis, trade.inputAmount.currency.wrapped.address),
      outputCurrencyId: buildCurrencyId(UniverseChainId.Gnosis, trade.outputAmount.currency.wrapped.address),
      name: 'Velora',
    },
  ]
}

export function isGnosisVeloraRoutableTrade(trade: Trade): boolean {
  return isClassic(trade) && isGnosisVeloraQuote(trade.quote.quote as TradingApi.ClassicQuote)
}

export const veloraRoutingProvider: RoutingProvider = {
  name: 'Velora',

  getRoutingEntries: (trade: Trade): RoutingDiagramEntry[] => {
    if (!isGnosisVeloraRoutableTrade(trade)) {
      throw new Error(`Invalid call to veloraRoutingProvider.getRoutingEntries with routing: ${trade.routing}`)
    }

    const metadata = getGnosisVeloraQuoteMetadata(trade.quote.quote as TradingApi.ClassicQuote)
    const legs = metadata ? getVeloraRouteLegs(metadata.priceRoute) : []
    if (!legs.length) {
      const path = getFallbackPath(trade)
      return [{ percent: new Percent(100, 100), path, protocolLabel: 'Velora' }]
    }

    return legs.map((leg) => {
      const path = leg.swaps.map((swap) => ({
        type: 'genericHop' as const,
        inputCurrencyId: currencyIdForVeloraToken(swap.srcToken),
        outputCurrencyId: currencyIdForVeloraToken(swap.destToken),
        name: getSwapExchangeLabel(swap),
      }))

      const routePath = path.length ? path : getFallbackPath(trade)
      return {
        percent: getRoutePercent(leg),
        path: routePath,
        protocolLabel: getProtocolLabel(routePath),
      }
    })
  },
}
