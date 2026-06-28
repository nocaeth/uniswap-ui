import { CurrencyAmount, Price, Token } from '@uniswap/sdk-core'
import { DAI, USDC_MAINNET } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { UTCTimestamp } from 'lightweight-charts'
import type { PriceChartData } from '~/components/Charts/PriceChart'
import {
  getCrosshairProps,
  getVisiblePriceBounds,
  isEffectivelyInfinity,
  priceToNumber,
} from '~/features/Liquidity/charts/LiquidityPositionRangeChart/utils'

function pricePoint(time: number, value: number): PriceChartData {
  return {
    time: time as UTCTimestamp,
    value,
    open: value,
    high: value,
    low: value,
    close: value,
  }
}

describe('LiquidityPositionRangeChart utils', () => {
  describe('getCrosshairProps', () => {
    it('should return correct positioning props', () => {
      const color = '#FF0000'
      const coordinates = { xCoordinate: 100, yCoordinate: 200 }

      const result = getCrosshairProps(color, coordinates)

      expect(result).toEqual({
        position: 'absolute',
        left: 97, // 100 - 3
        top: 197, // 200 - 3
        width: 6,
        height: 6,
        borderRadius: '$roundedFull',
        backgroundColor: color,
      })
    })

    it('should handle zero coordinates', () => {
      const color = '#000000'
      const coordinates = { xCoordinate: 0, yCoordinate: 0 }

      const result = getCrosshairProps(color, coordinates)

      expect(result).toEqual({
        position: 'absolute',
        left: -3,
        top: -3,
        width: 6,
        height: 6,
        borderRadius: '$roundedFull',
        backgroundColor: color,
      })
    })

    it('should handle negative coordinates', () => {
      const color = '#00FF00'
      const coordinates = { xCoordinate: -50, yCoordinate: -100 }

      const result = getCrosshairProps(color, coordinates)

      expect(result).toEqual({
        position: 'absolute',
        left: -53,
        top: -103,
        width: 6,
        height: 6,
        borderRadius: '$roundedFull',
        backgroundColor: color,
      })
    })
  })

  describe('isEffectivelyInfinity', () => {
    it('should return true for very large numbers', () => {
      expect(isEffectivelyInfinity(1e21)).toBe(true)
      expect(isEffectivelyInfinity(-1e21)).toBe(true)
    })

    it('should return true for very small numbers', () => {
      expect(isEffectivelyInfinity(1e-21)).toBe(true)
      expect(isEffectivelyInfinity(-1e-21)).toBe(true)
      expect(isEffectivelyInfinity(0)).toBe(true)
    })

    it('should return false for normal numbers', () => {
      expect(isEffectivelyInfinity(1)).toBe(false)
      expect(isEffectivelyInfinity(-1)).toBe(false)
      expect(isEffectivelyInfinity(1e19)).toBe(false)
      expect(isEffectivelyInfinity(1e-19)).toBe(false)
    })
  })

  describe('priceToNumber', () => {
    it('should return 0 when price is undefined', () => {
      expect(priceToNumber(undefined, 0)).toBe(0)
    })

    it('should convert price to number with correct decimals', () => {
      const baseAmount = CurrencyAmount.fromRawAmount(USDC_MAINNET, '1000000') // 1 USDC
      const quoteAmount = CurrencyAmount.fromRawAmount(DAI, '2000000000000000000')
      const price = new Price(USDC_MAINNET, DAI, baseAmount.quotient, quoteAmount.quotient)

      expect(priceToNumber(price, 0)).toBe(2)
    })

    it('should handle currency with no decimals', () => {
      const noDecimalsCurrency = new Token(
        UniverseChainId.Mainnet,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        0,
        'NoDecimals',
        'NDC',
      )

      const baseAmount = CurrencyAmount.fromRawAmount(noDecimalsCurrency, '1')
      const quoteAmount = CurrencyAmount.fromRawAmount(noDecimalsCurrency, '2')
      const price = new Price(noDecimalsCurrency, noDecimalsCurrency, baseAmount.quotient, quoteAmount.quotient)

      expect(priceToNumber(price, 0)).toBe(2)
    })
  })

  describe('getVisiblePriceBounds', () => {
    it('includes position range bounds with padding', () => {
      const bounds = getVisiblePriceBounds({
        data: [pricePoint(1, 100), pricePoint(2, 110)],
        positionPriceLower: 80,
        positionPriceUpper: 130,
      })

      expect(bounds.minVisiblePrice).toBeCloseTo(76)
      expect(bounds.maxVisiblePrice).toBeCloseTo(134)
    })

    it('ignores full-range sentinel values', () => {
      const bounds = getVisiblePriceBounds({
        data: [pricePoint(1, 100), pricePoint(2, 120)],
        positionPriceLower: 1e-30,
        positionPriceUpper: 1e30,
      })

      expect(bounds.minVisiblePrice).toBeCloseTo(98.4)
      expect(bounds.maxVisiblePrice).toBeCloseTo(121.6)
    })

    it('pads flat price data', () => {
      const bounds = getVisiblePriceBounds({
        data: [pricePoint(1, 100), pricePoint(2, 100)],
      })

      expect(bounds.minVisiblePrice).toBeCloseTo(95)
      expect(bounds.maxVisiblePrice).toBeCloseTo(105)
    })
  })
})
