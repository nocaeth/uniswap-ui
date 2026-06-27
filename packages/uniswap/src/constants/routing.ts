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
import { areAddressesEqual } from 'uniswap/src/utils/addresses'
import { isNativeCurrencyAddress } from 'uniswap/src/utils/currencyId'

type ChainCurrencyList = {
  readonly [chainId: number]: CurrencyInfo[]
}

/**
 * @deprecated
 * Instead, see the list used in the token selector's quick-select common options section at useAllCommonBaseCurrencies.ts.
 * This list is currently used as fallback list when Token GQL query fails for above list + for hardcoded tokens on testnet chains.
 */
export const COMMON_BASES: ChainCurrencyList = {
  // GNOSIS-ONLY: Gnosis token universe, seeded from the CoW Swap token list
  // (https://files.cow.fi/tokens/CowSwap.json). Uniswap's backend does not serve
  // Gnosis, so these provide both token metadata resolution (getCommonBase) and the
  // default token-selector list when the GQL query returns empty.
  [UniverseChainId.Gnosis]: [
    nativeOnChain(UniverseChainId.Gnosis), // xDAI
    new Token(UniverseChainId.Gnosis, '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', 18, 'WXDAI', 'Wrapped XDAI'),
    new Token(
      UniverseChainId.Gnosis,
      '0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1',
      18,
      'WETH',
      'Wrapped Ether on Gnosis',
    ),
    new Token(UniverseChainId.Gnosis, '0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252', 8, 'WBTC', 'Wrapped BTC on Gnosis'),
    new Token(UniverseChainId.Gnosis, '0x9c58bacc331c9aa871afd802db6379a98e80cedb', 18, 'GNO', 'Gnosis'),
    new Token(
      UniverseChainId.Gnosis,
      '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0',
      6,
      'USDC.e',
      'Bridged USDC (Gnosis)',
    ),
    new Token(UniverseChainId.Gnosis, '0x4ecaba5870353805a9f068101a40e0f32ed605c6', 6, 'USDT', 'Tether USD on xDai'),
    new Token(UniverseChainId.Gnosis, '0xaf204776c7245bf4147c2612bf6e5972ee483701', 18, 'sDAI', 'Savings xDAI'),
    new Token(
      UniverseChainId.Gnosis,
      '0x44fA8E6f47987339850636F88629646662444217',
      18,
      'DAI',
      'Dai Stablecoin on Gnosis',
    ),
    new Token(UniverseChainId.Gnosis, '0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430', 18, 'EURe', 'Monerium EUR emoney'),
    new Token(UniverseChainId.Gnosis, '0x5cb9073902f2035222b9749f8fb0c9bfe5527108', 18, 'GBPe', 'Monerium GBP emoney'),
    new Token(UniverseChainId.Gnosis, '0x177127622c4A00F3d409B75571e12cB3c8973d3c', 18, 'COW', 'CoW Protocol Token'),
    new Token(UniverseChainId.Gnosis, '0x4d18815d14fe5c3304e87b3fa18318baa5c23820', 18, 'SAFE', 'Safe Token'),
    new Token(
      UniverseChainId.Gnosis,
      '0x6c76971f98945ae98dd7d4dfca8711ebea946ea6',
      18,
      'wstETH',
      'Wrapped liquid staked Ether',
    ),
    new Token(UniverseChainId.Gnosis, '0xc791240d1f2def5938e2031364ff4ed887133c3d', 18, 'rETH', 'Rocket Pool ETH'),
    new Token(
      UniverseChainId.Gnosis,
      '0xE2e73A1c69ecF83F464EFCE6A5be353a37cA09b2',
      18,
      'LINK',
      'ChainLink Token on Gnosis',
    ),
    new Token(
      UniverseChainId.Gnosis,
      '0xabef652195f98a91e490f047a5006b71c85f058d',
      18,
      'crvUSD',
      'Curve.Fi USD Stablecoin',
    ),
    new Token(UniverseChainId.Gnosis, '0xca5d8f8a8d49439357d3cf46ca2e720702f132b8', 18, 'GYD', 'Gyro Dollar'),
    new Token(UniverseChainId.Gnosis, '0x1509706a6c66ca549ff0cb464de88231ddbe213b', 18, 'AURA', 'Aura Finance'),
    new Token(UniverseChainId.Gnosis, '0x3a97704a1b25F08aa230ae53B352e2e72ef52843', 18, 'AGVE', 'Agave Token'),
    new Token(UniverseChainId.Gnosis, '0x71850b7E9Ee3f13Ab46d67167341E4bDc905Eef9', 18, 'HNY', 'Honey'),
    new Token(UniverseChainId.Gnosis, '0xce11e14225575945b8e6dc0d4f2dd4c570f79d9f', 18, 'OLAS', 'Autonolas on Gnosis'),
    new Token(
      UniverseChainId.Gnosis,
      '0xb7D311E2Eb55F2f68a9440da38e7989210b9A05e',
      18,
      'STAKE',
      'Stake on Gnosis Chain',
    ),
  ].map(buildPartialCurrencyInfo),

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

  return networkName
    ? `${UniswapStaticUrls.uniswapAssetsBlockchainsBaseUrl}/${networkName}/assets/${address}/logo.png`
    : undefined
}

export function buildPartialCurrencyInfo(commonBase: Currency): CurrencyInfo {
  const logoUrl = commonBase.isNative
    ? getNativeLogoURI(commonBase.chainId)
    : getTokenLogoURI(commonBase.chainId, commonBase.address)

  return buildCurrencyInfo({
    currency: commonBase,
    logoUrl,
    safetyInfo: {
      tokenList: TokenList.Default,
      protectionResult: GraphQLApi.ProtectionResult.Benign,
    },
    isSpam: false,
  } as CurrencyInfo)
}
