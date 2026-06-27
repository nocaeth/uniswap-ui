import { COMMON_BASES } from 'uniswap/src/constants/routing'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_EURE_CANONICAL_ADDRESS,
  GNOSIS_EURE_LEGACY_ADDRESS,
  GNOSIS_GBPE_CANONICAL_ADDRESS,
  GNOSIS_GBPE_LEGACY_ADDRESSES,
} from 'uniswap/src/features/tokens/gnosisCanonicalTokens'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

describe('Routing', () => {
  describe('COMMON_BASES', () => {
    it('contains all coins for mainnet', () => {
      const symbols = COMMON_BASES[UniverseChainId.Mainnet].map((coin) => coin.currency.symbol)
      expect(symbols).toEqual(['ETH', 'DAI', 'USDC', 'USDT', 'WBTC', 'WETH'])
    })
    it('contains all coins for arbitrum', () => {
      const symbols = COMMON_BASES[UniverseChainId.ArbitrumOne].map((coin) => coin.currency.symbol)
      expect(symbols).toEqual(['ETH', 'ARB', 'DAI', 'USDC', 'USDT', 'WBTC', 'WETH'])
    })
    it('contains all coins for optimism', () => {
      const symbols = COMMON_BASES[UniverseChainId.Optimism].map((coin) => coin.currency.symbol)
      expect(symbols).toEqual(['ETH', 'OP', 'DAI', 'USDC', 'USDT', 'WBTC', 'WETH'])
    })
    it('contains all coins for polygon', () => {
      const symbols = COMMON_BASES[UniverseChainId.Polygon].map((coin) => coin.currency.symbol)
      expect(symbols).toEqual(['POL', 'WETH', 'USDC', 'DAI', 'USDT', 'WBTC'])
    })
    it('contains all coins for celo', () => {
      const symbols = COMMON_BASES[UniverseChainId.Celo].map((coin) => coin.currency.symbol)
      expect(symbols).toEqual(['CELO', 'USDC'])
    })
    it('contains all coins for bsc', () => {
      const symbols = COMMON_BASES[UniverseChainId.Bnb].map((coin) => coin.currency.symbol)
      expect(symbols).toEqual(['BNB', 'DAI', 'USDC', 'USDT', 'WETH', 'BUSD'])
    })
    it('contains canonical Gnosis EURe and GBPe, not legacy aliases', () => {
      const tokenAddresses = COMMON_BASES[UniverseChainId.Gnosis].flatMap((coin) =>
        coin.currency.isToken ? [coin.currency.address] : [],
      )
      const containsAddress = (address: string): boolean =>
        tokenAddresses.some((tokenAddress) =>
          areAddressesEqual({
            addressInput1: {
              address: tokenAddress,
              chainId: UniverseChainId.Gnosis,
            },
            addressInput2: { address, chainId: UniverseChainId.Gnosis },
          }),
        )

      expect(containsAddress(GNOSIS_EURE_CANONICAL_ADDRESS)).toBe(true)
      expect(containsAddress(GNOSIS_GBPE_CANONICAL_ADDRESS)).toBe(true)
      expect(containsAddress(GNOSIS_EURE_LEGACY_ADDRESS)).toBe(false)
      expect(containsAddress(GNOSIS_GBPE_LEGACY_ADDRESSES[0])).toBe(false)
    })
  })
})
