import { Currency, Token, WETH9 } from '@uniswap/sdk-core'
import { GraphQLApi } from '@universe/api'
import type { ImageSourcePropType } from 'react-native'
import { CELO_LOGO, ETH_LOGO } from 'ui/src/assets'
import {
  ARB,
  AUSD_MONAD,
  BTC_B_MEGAETH,
  BUSD_BSC,
  CIRBTC_ARC,
  DAI,
  DAI_ARBITRUM_ONE,
  DAI_AVALANCHE,
  DAI_BSC,
  DAI_OPTIMISM,
  DAI_POLYGON,
  ETH_BSC,
  EURC_ARC,
  nativeOnChain,
  OP,
  PATHUSD_TEMPO,
  PORTAL_ETH_CELO,
  UNI,
  USDC_ARBITRUM,
  USDC_ARC,
  USDC_AVALANCHE,
  USDC_BASE,
  USDC_BSC,
  USDC_CELO,
  USDC_E_TEMPO,
  USDC_LINEA,
  USDC_MAINNET,
  USDC_MONAD,
  USDC_OPTIMISM,
  USDC_POLYGON,
  USDC_SEPOLIA,
  USDC_SOLANA,
  USDC_SONEIUM,
  USDC_UNICHAIN,
  USDC_WORLD_CHAIN,
  USDC_XLAYER,
  USDC_ZKSYNC,
  USDC_ZORA,
  USDE_MEGAETH,
  USDG_ROBINHOOD,
  USDT,
  USDT_ARBITRUM_ONE,
  USDT_AVALANCHE,
  USDT_BSC,
  USDT_LINEA,
  USDT_OPTIMISM,
  USDT_POLYGON,
  USDT0_XLAYER,
  USDM_MEGAETH,
  USYC_ARC,
  WBTC,
  WBTC_ARBITRUM_ONE,
  WBTC_OPTIMISM,
  WBTC_POLYGON,
  WETH_ARC,
  WETH_AVALANCHE,
  WETH_POLYGON,
  WRAPPED_NATIVE_CURRENCY,
} from 'uniswap/src/constants/tokens'
import { UniswapStaticUrls } from 'uniswap/src/constants/urls'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo, TokenList } from 'uniswap/src/features/dataApi/types'
import { buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import {
  GNOSIS_EURE_CANONICAL_ADDRESS,
  GNOSIS_GBPE_CANONICAL_ADDRESS,
} from 'uniswap/src/features/tokens/gnosisCanonicalTokens'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'
import { currencyId, isNativeCurrencyAddress } from 'uniswap/src/utils/currencyId'

type ChainCurrencyList = {
  readonly [chainId: number]: CurrencyInfo[]
}

type GnosisTokenListToken = {
  readonly address: string
  readonly decimals: number
  readonly symbol: string
  readonly name: string
  readonly logoURI?: string
}

const GNOSIS_TOKEN_LIST_LOGO_BASE_URI = 'https://raw.githubusercontent.com/nocaeth/gc-tokenlist/main/assets/100'

export const GNOSIS_TOKEN_LIST = [
  {
    address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
    decimals: 18,
    symbol: 'WXDAI',
    name: 'Wrapped XDAI',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xe91d153e0b41518a2ce8dd3d7944fa863463a97d/logo.png`,
  },
  {
    address: '0xaf204776c7245bF4147c2612BF6e5972Ee483701',
    decimals: 18,
    symbol: 'sDAI',
    name: 'Savings xDAI',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xaf204776c7245bf4147c2612bf6e5972ee483701/logo.png`,
  },
  {
    address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb',
    decimals: 18,
    symbol: 'GNO',
    name: 'Gnosis',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x9c58bacc331c9aa871afd802db6379a98e80cedb/logo.png`,
  },
  {
    address: '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1',
    decimals: 18,
    symbol: 'WETH',
    name: 'Gnosis xDai Bridged WETH',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1/logo.png`,
  },
  {
    address: '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6',
    decimals: 18,
    symbol: 'wstETH',
    name: 'Bridged Wrapped stETH',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x6c76971f98945ae98dd7d4dfca8711ebea946ea6/logo.png`,
  },
  {
    address: '0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252',
    decimals: 8,
    symbol: 'WBTC',
    name: 'Gnosis xDai Bridged WBTC',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x8e5bbbb09ed1ebde8674cda39a0c169401db4252/logo.png`,
  },
  {
    address: '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0',
    decimals: 6,
    symbol: 'USDC.e',
    name: 'Gnosis xDAI Bridged USDC',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x2a22f9c3b484c3629090feed35f17ff8f88f76f0/logo.png`,
  },
  {
    address: '0x4ECaBa5870353805a9F068101A40E0f32ed605C6',
    decimals: 6,
    symbol: 'USDT',
    name: 'xDai Bridged USDT',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x4ecaba5870353805a9f068101a40e0f32ed605c6/logo.png`,
  },
  {
    address: GNOSIS_EURE_CANONICAL_ADDRESS,
    decimals: 18,
    symbol: 'EURe',
    name: 'Monerium EURe',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430/logo.png`,
  },
  {
    address: GNOSIS_GBPE_CANONICAL_ADDRESS,
    decimals: 18,
    symbol: 'GBPe',
    name: 'Monerium GBPe',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x8e34bfec4f6eb781f9743d9b4af99cd23f9b7053/logo.png`,
  },
  {
    address: '0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73',
    decimals: 18,
    symbol: 'GHO',
    name: 'GHO',
  },
  {
    address: '0xaBEf652195F98A91E490f047A5006B71c85f058d',
    decimals: 18,
    symbol: 'crvUSD',
    name: 'Curve.Fi USD Stablecoin',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xabef652195f98a91e490f047a5006b71c85f058d/logo.png`,
  },
  {
    address: '0x4b1E2c2762667331Bc91648052F646d1b0d35984',
    decimals: 18,
    symbol: 'EURA',
    name: 'EURA',
  },
  {
    address: '0x54E4cB2a4Fa0ee46E3d9A98D13Bea119666E09f6',
    decimals: 6,
    symbol: 'EURC.e',
    name: 'Omnibridge Bridged EURC',
  },
  {
    address: '0xFECB3F7c54E2CAAE9dC6Ac9060A822D47E053760',
    decimals: 18,
    symbol: 'BRLA',
    name: 'BRLA Token',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xfecb3f7c54e2caae9dc6ac9060a822d47e053760/logo.png`,
  },
  {
    address: '0x177127622c4A00F3d409B75571e12cB3c8973d3c',
    decimals: 18,
    symbol: 'COW',
    name: 'CoW Protocol Token',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x177127622c4a00f3d409b75571e12cb3c8973d3c/logo.png`,
  },
  {
    address: '0x4d18815D14fe5c3304e87B3FA18318baa5c23820',
    decimals: 18,
    symbol: 'SAFE',
    name: 'Safe Token',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x4d18815d14fe5c3304e87b3fa18318baa5c23820/logo.png`,
  },
  {
    address: '0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f',
    decimals: 18,
    symbol: 'OLAS',
    name: 'Autonolas',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xce11e14225575945b8e6dc0d4f2dd4c570f79d9f/logo.png`,
  },
  {
    address: '0x71850b7E9Ee3f13Ab46d67167341E4bDc905Eef9',
    decimals: 18,
    symbol: 'HNY',
    name: 'Honey',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x71850b7e9ee3f13ab46d67167341e4bdc905eef9/logo.png`,
  },
  {
    address: '0x1509706a6c66CA549ff0cB464de88231DDBe213B',
    decimals: 18,
    symbol: 'AURA',
    name: 'Aura Finance',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0x1509706a6c66ca549ff0cb464de88231ddbe213b/logo.png`,
  },
  {
    address: '0xD057604A14982FE8D88c5fC25Aac3267eA142a08',
    decimals: 18,
    symbol: 'HOPR',
    name: 'HOPR',
  },
  {
    address: '0xc791240D1F2dEf5938E2031364Ff4ed887133C3d',
    decimals: 18,
    symbol: 'rETH',
    name: 'Rocket Pool ETH',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xc791240d1f2def5938e2031364ff4ed887133c3d/logo.png`,
  },
  {
    address: '0xF490c80aAE5f2616d3e3BDa2483E30C4CB21d1A0',
    decimals: 18,
    symbol: 'osGNO',
    name: 'StakeWise Staked GNO',
    logoURI: `${GNOSIS_TOKEN_LIST_LOGO_BASE_URI}/0xf490c80aae5f2616d3e3bda2483e30c4cb21d1a0/logo.png`,
  },
] as const satisfies readonly GnosisTokenListToken[]

function buildGnosisTokenListCurrencyInfo(tokenInfo: GnosisTokenListToken): CurrencyInfo {
  return buildPartialCurrencyInfoWithLogo(
    new Token(
      UniverseChainId.Gnosis,
      tokenInfo.address,
      tokenInfo.decimals,
      tokenInfo.symbol,
      tokenInfo.name,
    ),
    tokenInfo.logoURI,
  )
}

/**
 * @deprecated
 * Instead, see the list used in the token selector's quick-select common options section at useAllCommonBaseCurrencies.ts.
 * This list is currently used as fallback list when Token GQL query fails for above list + for hardcoded tokens on testnet chains.
 */
export const COMMON_BASES: ChainCurrencyList = {
  // GNOSIS-ONLY: Gnosis token universe, seeded from Noca's canonical Gnosis list
  // (https://github.com/nocaeth/gc-tokenlist). Uniswap's backend does not serve
  // Gnosis, so these provide both token metadata resolution (getCommonBase) and the
  // default token-selector list when the GQL query returns empty.
  [UniverseChainId.Gnosis]: [
    buildPartialCurrencyInfo(nativeOnChain(UniverseChainId.Gnosis)), // xDAI
    ...GNOSIS_TOKEN_LIST.map(buildGnosisTokenListCurrencyInfo),
  ],

  [UniverseChainId.Mainnet]: [
    nativeOnChain(UniverseChainId.Mainnet),
    DAI,
    USDC_MAINNET,
    USDT,
    WBTC,
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Mainnet] as Token,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.ArbitrumOne]: [
    nativeOnChain(UniverseChainId.ArbitrumOne),
    ARB,
    DAI_ARBITRUM_ONE,
    USDC_ARBITRUM,
    USDT_ARBITRUM_ONE,
    WBTC_ARBITRUM_ONE,
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.ArbitrumOne] as Token,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Avalanche]: [
    nativeOnChain(UniverseChainId.Avalanche),
    DAI_AVALANCHE,
    USDC_AVALANCHE,
    USDT_AVALANCHE,
    WETH_AVALANCHE,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Base]: [
    nativeOnChain(UniverseChainId.Base),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Base] as Token,
    USDC_BASE,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Blast]: [
    nativeOnChain(UniverseChainId.Blast),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Blast] as Token,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Bnb]: [nativeOnChain(UniverseChainId.Bnb), DAI_BSC, USDC_BSC, USDT_BSC, ETH_BSC, BUSD_BSC].map(
    buildPartialCurrencyInfo,
  ),

  [UniverseChainId.Celo]: [nativeOnChain(UniverseChainId.Celo), USDC_CELO].map(buildPartialCurrencyInfo),

  [UniverseChainId.Monad]: [
    nativeOnChain(UniverseChainId.Monad),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Monad] as Token,
    USDC_MONAD,
    AUSD_MONAD,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Optimism]: [
    nativeOnChain(UniverseChainId.Optimism),
    OP,
    DAI_OPTIMISM,
    USDC_OPTIMISM,
    USDT_OPTIMISM,
    WBTC_OPTIMISM,
    WETH9[UniverseChainId.Optimism] as Token,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Polygon]: [
    nativeOnChain(UniverseChainId.Polygon),
    WETH_POLYGON,
    USDC_POLYGON,
    DAI_POLYGON,
    USDT_POLYGON,
    WBTC_POLYGON,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Sepolia]: [
    nativeOnChain(UniverseChainId.Sepolia),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Sepolia] as Token,
    USDC_SEPOLIA,
    UNI[UniverseChainId.Sepolia],
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Linea]: [
    nativeOnChain(UniverseChainId.Linea),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Linea] as Token,
    USDC_LINEA,
    USDT_LINEA,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.MegaETH]: [
    nativeOnChain(UniverseChainId.MegaETH),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.MegaETH] as Token,
    USDM_MEGAETH,
    USDE_MEGAETH,
    BTC_B_MEGAETH,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Robinhood]: [
    nativeOnChain(UniverseChainId.Robinhood),
    USDG_ROBINHOOD,
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Robinhood] as Token,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Arc]: [USDC_ARC, EURC_ARC, CIRBTC_ARC, WETH_ARC, USYC_ARC].map(buildPartialCurrencyInfo),

  [UniverseChainId.Soneium]: [
    nativeOnChain(UniverseChainId.Soneium),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Soneium] as Token,
    USDC_SONEIUM,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Tempo]: [PATHUSD_TEMPO, USDC_E_TEMPO].map(buildPartialCurrencyInfo),

  [UniverseChainId.XLayer]: [WRAPPED_NATIVE_CURRENCY[UniverseChainId.XLayer] as Token, USDC_XLAYER, USDT0_XLAYER].map(
    buildPartialCurrencyInfo,
  ),

  [UniverseChainId.Solana]: [nativeOnChain(UniverseChainId.Solana), USDC_SOLANA].map(buildPartialCurrencyInfo),

  [UniverseChainId.Unichain]: [
    nativeOnChain(UniverseChainId.Unichain),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Unichain] as Token,
    USDC_UNICHAIN,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.UnichainSepolia]: [
    nativeOnChain(UniverseChainId.UnichainSepolia),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.UnichainSepolia] as Token,
    // TODO(WEB-5160): re-add usdc sepolia
    // USDC_UNICHAIN_SEPOLIA,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.WorldChain]: [
    nativeOnChain(UniverseChainId.WorldChain),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.WorldChain] as Token,
    USDC_WORLD_CHAIN,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Zksync]: [
    nativeOnChain(UniverseChainId.Zksync),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Zksync] as Token,
    USDC_ZKSYNC,
  ].map(buildPartialCurrencyInfo),

  [UniverseChainId.Zora]: [
    nativeOnChain(UniverseChainId.Zora),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Zora] as Token,
    USDC_ZORA,
  ].map(buildPartialCurrencyInfo),
}

export function getCommonBase(chainId?: number, address?: string): CurrencyInfo | undefined {
  if (!address || !chainId) {
    return undefined
  }

  const isNative = isNativeCurrencyAddress(chainId, address)
  return COMMON_BASES[chainId]?.find(
    (base) =>
      (base.currency.isNative && isNative) ||
      (base.currency.isToken &&
        areAddressesEqual({
          addressInput1: { address: base.currency.address, chainId: base.currency.chainId },
          addressInput2: { address, chainId },
        })),
  )
}

function getNativeLogoURI(chainId: UniverseChainId = UniverseChainId.Mainnet): ImageSourcePropType {
  if (chainId === UniverseChainId.Mainnet) {
    return ETH_LOGO as ImageSourcePropType
  }

  return getChainInfo(chainId).nativeCurrency.logo
}

function getTokenLogoURI(chainId: UniverseChainId, address: string): ImageSourcePropType | string | undefined {
  const chainInfo = getChainInfo(chainId)
  const networkName = chainInfo.assetRepoNetworkName

  if (
    chainId === UniverseChainId.Celo &&
    areAddressesEqual({
      addressInput1: { address, platform: Platform.EVM },
      addressInput2: { address: nativeOnChain(chainId).wrapped.address, platform: Platform.EVM },
    })
  ) {
    return CELO_LOGO as ImageSourcePropType
  }
  if (
    chainId === UniverseChainId.Celo &&
    areAddressesEqual({
      addressInput1: { address, platform: Platform.EVM },
      addressInput2: { address: PORTAL_ETH_CELO.address, platform: Platform.EVM },
    })
  ) {
    return ETH_LOGO as ImageSourcePropType
  }

  return networkName && UniswapStaticUrls.uniswapAssetsBlockchainsBaseUrl
    ? `${UniswapStaticUrls.uniswapAssetsBlockchainsBaseUrl}/${networkName}/assets/${address}/logo.png`
    : undefined
}

function buildPartialCurrencyInfoWithLogo(commonBase: Currency, logoURI?: string): CurrencyInfo {
  const logoUrl = logoURI ?? (commonBase.isNative
    ? getNativeLogoURI(commonBase.chainId)
    : getTokenLogoURI(commonBase.chainId, commonBase.address))

  return buildCurrencyInfo({
    currency: commonBase,
    currencyId: currencyId(commonBase),
    logoUrl,
    safetyInfo: {
      tokenList: TokenList.Default,
      protectionResult: GraphQLApi.ProtectionResult.Benign,
    },
    isSpam: false,
  } as CurrencyInfo)
}

export function buildPartialCurrencyInfo(commonBase: Currency): CurrencyInfo {
  return buildPartialCurrencyInfoWithLogo(commonBase)
}
