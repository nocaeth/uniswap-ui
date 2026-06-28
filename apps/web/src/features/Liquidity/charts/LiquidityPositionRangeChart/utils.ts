import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'
import { FlexProps } from 'ui/src/components/layout/Flex'
import type { PriceChartData } from '~/components/Charts/PriceChart'

export function getCrosshairProps(
  color: any,
  { yCoordinate, xCoordinate }: { yCoordinate: number; xCoordinate: number },
): FlexProps {
  return {
    position: 'absolute',
    left: xCoordinate - 3,
    top: yCoordinate - 3, // Center the crosshair vertically on the price line.
    width: 6,
    height: 6,
    borderRadius: '$roundedFull',
    backgroundColor: color,
  }
}

export function isEffectivelyInfinity(value: number): boolean {
  return Math.abs(value) >= 1e20 || Math.abs(value) <= 1e-20
}

export function priceToNumber(price: Maybe<Price<Currency, Currency>>, defaultValue: number): number {
  const baseCurrency = price?.baseCurrency
  if (!baseCurrency) {
    return defaultValue
  }

  const sigFigs = Boolean(baseCurrency.decimals) && baseCurrency.decimals > 0 ? baseCurrency.decimals : 6

  const numPrice = Number(
    price.quote(CurrencyAmount.fromRawAmount(baseCurrency, Math.pow(10, baseCurrency.decimals))).toSignificant(sigFigs),
  )

  if (isEffectivelyInfinity(numPrice)) {
    return defaultValue
  }

  return numPrice
}

function finitePrice(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && !Number.isNaN(value)
}

function rangeBoundToNumber(
  price: Maybe<Price<Currency, Currency>> | number | undefined,
  defaultValue: number,
): number {
  if (typeof price === 'number') {
    return isEffectivelyInfinity(price) ? defaultValue : price
  }
  return priceToNumber(price, defaultValue)
}

export function getVisiblePriceBounds({
  data,
  positionPriceLower,
  positionPriceUpper,
}: {
  data: PriceChartData[]
  positionPriceLower?: Maybe<Price<Currency, Currency>> | number
  positionPriceUpper?: Maybe<Price<Currency, Currency>> | number
}): { minVisiblePrice?: number; maxVisiblePrice?: number } {
  const dataPrices = data.flatMap((entry) => [entry.value, entry.open, entry.high, entry.low, entry.close]).filter(finitePrice)
  const lower = rangeBoundToNumber(positionPriceLower, Number.NaN)
  const upper = rangeBoundToNumber(positionPriceUpper, Number.NaN)
  const prices = [...dataPrices, lower, upper].filter(finitePrice)

  if (prices.length === 0) {
    return {}
  }

  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  if (minPrice === maxPrice) {
    const padding = Math.abs(minPrice) * 0.05 || 1
    return {
      minVisiblePrice: Math.max(0, minPrice - padding),
      maxVisiblePrice: maxPrice + padding,
    }
  }

  const padding = (maxPrice - minPrice) * 0.08
  return {
    minVisiblePrice: Math.max(0, minPrice - padding),
    maxVisiblePrice: maxPrice + padding,
  }
}
