import { NativeCurrency, Token } from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { buildCurrency, buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { getGnosisTokenListLogoURI } from 'uniswap/src/features/tokens/gnosisTokenList'
import { currencyId } from 'uniswap/src/utils/currencyId'

const TEST_TOKEN_ADDRESS = '0xabcdef0123456789abcdef0123456789abcdef01'
const GNOSIS_WSTETH_ADDRESS = '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6'

describe(buildCurrency, () => {
  it('should return a new Token instance when all parameters are provided', () => {
    const token = buildCurrency({
      chainId: UniverseChainId.Mainnet,
      address: TEST_TOKEN_ADDRESS,
      decimals: 0,
      symbol: 'TEST',
      name: 'Test Token',
    }) as Token
    expect(token).toBeInstanceOf(Token)
    expect(token.chainId).toBe(UniverseChainId.Mainnet)
    expect(token.address).toBe(TEST_TOKEN_ADDRESS)
    expect(token.decimals).toBe(0)
    expect(token.symbol).toBe('TEST')
    expect(token.name).toBe('Test Token')
  })

  it('should return the same reference when the same parameters are provided', () => {
    const args = {
      chainId: UniverseChainId.Mainnet,
      address: TEST_TOKEN_ADDRESS,
      decimals: 0,
      symbol: 'TEST',
      name: 'Test Token',
    }

    const tokenA = buildCurrency({ ...args }) as Token
    const tokenB = buildCurrency({ ...args }) as Token

    expect(tokenA).toBeInstanceOf(Token)
    expect(tokenA).toBe(tokenB)
  })

  it('should return a new NativeCurrency instance when address is not provided', () => {
    const nativeCurrency = buildCurrency({
      chainId: UniverseChainId.Mainnet,
      address: null,
      decimals: 18,
    }) as NativeCurrency
    expect(nativeCurrency).toBeInstanceOf(NativeCurrency)
    expect(nativeCurrency.chainId).toBe(UniverseChainId.Mainnet)
  })

  it('should return undefined when chainId or decimals are not provided', () => {
    expect(
      buildCurrency({
        chainId: null,
        address: '0x0',
        decimals: 18,
      }),
    ).toBeUndefined()
    expect(
      buildCurrency({
        chainId: UniverseChainId.Mainnet,
        address: '0x0',
        decimals: null,
      }),
    ).toBeUndefined()
  })
})

describe(buildCurrencyInfo, () => {
  it('uses the NOCA token-list logo when a Gnosis token has no backend logo', () => {
    const currency = new Token(UniverseChainId.Gnosis, GNOSIS_WSTETH_ADDRESS, 18, 'wstETH', 'Bridged Wrapped stETH')

    const result = buildCurrencyInfo({
      currency,
      currencyId: currencyId(currency),
      logoUrl: '',
      isSpam: false,
    })

    expect(result.logoUrl).toBe(
      getGnosisTokenListLogoURI({ chainId: UniverseChainId.Gnosis, address: GNOSIS_WSTETH_ADDRESS }),
    )
  })

  it('prefers the NOCA token-list logo over a backend logo for Gnosis tokens', () => {
    const currency = new Token(UniverseChainId.Gnosis, GNOSIS_WSTETH_ADDRESS, 18, 'wstETH', 'Bridged Wrapped stETH')

    const result = buildCurrencyInfo({
      currency,
      currencyId: currencyId(currency),
      logoUrl: 'https://example.com/wsteth.png',
      isSpam: false,
    })

    expect(result.logoUrl).toBe(
      getGnosisTokenListLogoURI({ chainId: UniverseChainId.Gnosis, address: GNOSIS_WSTETH_ADDRESS }),
    )
  })

  it('keeps backend logos for non-Gnosis tokens', () => {
    const currency = new Token(UniverseChainId.Mainnet, TEST_TOKEN_ADDRESS, 18, 'TEST', 'Test Token')

    const result = buildCurrencyInfo({
      currency,
      currencyId: currencyId(currency),
      logoUrl: 'https://example.com/test.png',
      isSpam: false,
    })

    expect(result.logoUrl).toBe('https://example.com/test.png')
  })
})
