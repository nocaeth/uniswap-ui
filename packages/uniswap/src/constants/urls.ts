import {
  DEV_ENTRY_GATEWAY_API_BASE_URL,
  getCloudflareApiBaseUrl,
  getMigratedForApiUrl,
  PROD_ENTRY_GATEWAY_API_BASE_URL,
  STAGING_ENTRY_GATEWAY_API_BASE_URL,
  TrafficFlows,
} from '@universe/api'
import { isWebApp, isBetaEnv, isDevEnv, isE2eTestEnv } from '@universe/environment'
import { FeatureFlags, getFeatureFlag } from '@universe/gating'

export const UNISWAP_WEB_HOSTNAME = 'swap.gno.now'
const UNISWAP_BACKEND_ORIGIN = `https://${UNISWAP_WEB_HOSTNAME}`
export const UNISWAP_WEB_URL = `https://${UNISWAP_WEB_HOSTNAME}`
export const CHROME_EXTENSION_UNINSTALL_URL_PATH = '/extension/uninstall'
// Liquidity service uses dedicated backend-{env} hosts. Dev and staging builds both use the staging
// backend (consistent with the entry gateway + websocket URLs, which collapse dev → staging to avoid
// localhost CORS); prod uses the prod backend. An explicit override always wins.
const STAGING_LIQUIDITY_SERVICE_URL = 'https://liquidity.backend-staging.api.uniswap.org'
const PROD_LIQUIDITY_SERVICE_URL = 'https://liquidity.backend-prod.api.uniswap.org'

const DISABLED_PUBLIC_LINK = ''

export const UniswapHelpUrls = {
  baseUrl: DISABLED_PUBLIC_LINK,
  requestUrl: DISABLED_PUBLIC_LINK,
  articles: {
    bridgedAssets: DISABLED_PUBLIC_LINK,
    acrossRoutingInfo: DISABLED_PUBLIC_LINK,
    approvalsExplainer: DISABLED_PUBLIC_LINK,
    batchedSwaps: DISABLED_PUBLIC_LINK,
    batchedSwapsFailure: DISABLED_PUBLIC_LINK,
    batchedSwapsReview: DISABLED_PUBLIC_LINK,
    cexTransferKorea: DISABLED_PUBLIC_LINK,
    contractAddressExplainer: DISABLED_PUBLIC_LINK,
    dappProtectionInfo: DISABLED_PUBLIC_LINK,
    extensionBiometricsEnrollment: DISABLED_PUBLIC_LINK,
    extensionHelp: DISABLED_PUBLIC_LINK,
    extensionDappTroubleshooting: DISABLED_PUBLIC_LINK,
    feeOnTransferHelp: DISABLED_PUBLIC_LINK,
    geoRestriction: DISABLED_PUBLIC_LINK,
    howToSwapTokens: DISABLED_PUBLIC_LINK,
    hiddenTokenInfo: DISABLED_PUBLIC_LINK,
    hiddenNFTInfo: DISABLED_PUBLIC_LINK,
    impermanentLoss: DISABLED_PUBLIC_LINK,
    jupiterApiError: DISABLED_PUBLIC_LINK,
    limitsFailure: DISABLED_PUBLIC_LINK,
    limitsInfo: DISABLED_PUBLIC_LINK,
    limitsNetworkSupport: DISABLED_PUBLIC_LINK,
    lpIncentiveInfo: DISABLED_PUBLIC_LINK,
    fiatOnRampHelp: DISABLED_PUBLIC_LINK,
    fiatOffRampHelp: DISABLED_PUBLIC_LINK,
    transferCryptoHelp: DISABLED_PUBLIC_LINK,
    mismatchedImports: DISABLED_PUBLIC_LINK,
    mobileWalletHelp: DISABLED_PUBLIC_LINK,
    moonpayRegionalAvailability: DISABLED_PUBLIC_LINK,
    multichainDelegation: DISABLED_PUBLIC_LINK,
    networkFeeInfo: DISABLED_PUBLIC_LINK,
    poolOutOfSync: DISABLED_PUBLIC_LINK,
    positionsLearnMore: DISABLED_PUBLIC_LINK,
    priceImpact: DISABLED_PUBLIC_LINK,
    providingLiquidityInfo: DISABLED_PUBLIC_LINK,
    providingLiquidityVersions: DISABLED_PUBLIC_LINK,
    recoveryPhraseHowToImport: DISABLED_PUBLIC_LINK,
    recoveryPhraseHowToFind: DISABLED_PUBLIC_LINK,
    recoveryPhraseForgotten: DISABLED_PUBLIC_LINK,
    revokeExplainer: DISABLED_PUBLIC_LINK,
    rwaExploreDisclaimer: DISABLED_PUBLIC_LINK,
    rwaExploreDisclaimerEtfs: DISABLED_PUBLIC_LINK,
    rwaOffHours: DISABLED_PUBLIC_LINK,
    supportedNetworks: DISABLED_PUBLIC_LINK,
    swapFeeInfo: DISABLED_PUBLIC_LINK,
    passkeysInfo: DISABLED_PUBLIC_LINK,
    smartWalletDelegation: DISABLED_PUBLIC_LINK,
    swapProtection: DISABLED_PUBLIC_LINK,
    swapSlippage: DISABLED_PUBLIC_LINK,
    swapDeadline: DISABLED_PUBLIC_LINK,
    tokenWarning: DISABLED_PUBLIC_LINK,
    transactionFailure: DISABLED_PUBLIC_LINK,
    uniswapXInfo: DISABLED_PUBLIC_LINK,
    uniswapXFailure: DISABLED_PUBLIC_LINK,
    unsupportedTokenPolicy: DISABLED_PUBLIC_LINK,
    addingV4Hooks: DISABLED_PUBLIC_LINK,
    routingSettings: DISABLED_PUBLIC_LINK,
    uniswapVersionsInfo: DISABLED_PUBLIC_LINK,
    v4HooksInfo: DISABLED_PUBLIC_LINK,
    subgraphDowntime: DISABLED_PUBLIC_LINK,
    walletSecurityMeasures: DISABLED_PUBLIC_LINK,
    whatIsPrivateKey: DISABLED_PUBLIC_LINK,
    wethExplainer: DISABLED_PUBLIC_LINK,
  },
}

export const UniswapStaticUrls = {
  downloadWalletUrl: DISABLED_PUBLIC_LINK,
  tradingApiDocsUrl: DISABLED_PUBLIC_LINK,
  unichainUrl: 'https://www.unichain.org/',
  uniswapXUrl: DISABLED_PUBLIC_LINK,
  blogUrl: DISABLED_PUBLIC_LINK,
  docsUrl: DISABLED_PUBLIC_LINK,
  voteUrl: DISABLED_PUBLIC_LINK,
  governanceUrl: DISABLED_PUBLIC_LINK,
  developersUrl: DISABLED_PUBLIC_LINK,
  aboutUrl: DISABLED_PUBLIC_LINK,
  careersUrl: DISABLED_PUBLIC_LINK,
  social: {
    x: DISABLED_PUBLIC_LINK,
    farcaster: DISABLED_PUBLIC_LINK,
    linkedin: DISABLED_PUBLIC_LINK,
    tiktok: DISABLED_PUBLIC_LINK,
  },
  bugBountyUrl: 'https://cantina.xyz/bounties/f9df94db-c7b1-434b-bb06-d1360abdd1be',
  termsOfServiceUrl: DISABLED_PUBLIC_LINK,
  privacyPolicyUrl: DISABLED_PUBLIC_LINK,
  chromeExtension: DISABLED_PUBLIC_LINK,
  chromeExtensionUninstallUrl: DISABLED_PUBLIC_LINK,

  // Download links
  appStoreDownloadUrl: DISABLED_PUBLIC_LINK,
  playStoreDownloadUrl: DISABLED_PUBLIC_LINK,

  // Core API Urls
  apiOrigin: UNISWAP_WEB_URL,

  // Merkl Docs for LP Incentives
  merklDocsUrl: 'https://docs.merkl.xyz/earn-with-merkl/faq-earn#how-are-aprs-calculated',

  uniswapAssetsBlockchainsBaseUrl: DISABLED_PUBLIC_LINK,

  // Embedded Wallet URL's
  // Totally fine that these are public
  evervaultDevUrl: 'https://embedded-wallet-dev.app-907329d19a06.enclave.evervault.com',
  evervaultStagingUrl: 'https://embedded-wallet-staging.app-907329d19a06.enclave.evervault.com',
  evervaultProductionUrl: 'https://embedded-wallet.app-907329d19a06.enclave.evervault.com',

  wormholeUrl: 'https://portalbridge.com/',

  // App and Redirect URL's
  appBaseUrl: UNISWAP_WEB_URL,
  redirectUrlBase: UNISWAP_WEB_URL,
  requestOriginUrl: UNISWAP_BACKEND_ORIGIN,

  // Web Interface Urls
  webInterfaceSwapUrl: `${UNISWAP_WEB_URL}/#/swap`,
  webInterfaceTokensUrl: `${UNISWAP_WEB_URL}/explore/tokens`,
  webInterfacePoolsUrl: `${UNISWAP_WEB_URL}/explore/pools`,
  webInterfacePortfolioUrl: `${UNISWAP_WEB_URL}/portfolio`,
  webInterfaceBuyUrl: `${UNISWAP_WEB_URL}/buy`,

  // Feedback Links
  walletFeedbackForm:
    'https://docs.google.com/forms/d/e/1FAIpQLSepzL5aMuSfRhSgw0zDw_gVmc2aeVevfrb1UbOwn6WGJ--46w/viewform',
}

/**
 * Config-derived URL overrides
 */
export interface UniswapUrlOverrides {
  amplitudeProxyUrlOverride?: string
  apiBaseUrlOverride?: string
  apiBaseUrlV2Override?: string
  forApiUrlOverride?: string
  graphqlUrlOverride?: string
  liquidityServiceUrlOverride?: string
  scantasticApiUrlOverride?: string
  statsigProxyUrlOverride?: string
  tradingApiUrlOverride?: string
  tradingApiWebTestEnv?: string
}

export interface UniswapServiceUrls {
  amplitudeProxyUrl: string
  apiBaseUrl: string
  apiBaseUrlV2: string
  complianceApiBaseUrl: string
  dataApiBaseUrlV2: string
  dataApiServiceUrl: string
  embeddedWalletHostname: string
  embeddedWalletUrl: string
  graphQLUrl: string
  liquidityServiceUrl: string
  passkeysManagementUrl: string
  privyEmbeddedWalletUrl: string
  privyEncryptedAuthorizationKeysUrl: string
  scantasticApiUrl: string
  statsigProxyUrl: string
  tradingApiUrl: string
}

/**
 * Resolves the FOR API URL, honoring the `ForUrlMigration` feature flag.
 * This is intentionally NOT part of `getUniswapServiceUrls`. Because it reads a feature flag,
 * adding it there breaks the flag override modal.
 * TODO: Move this into getUniswapServiceUrls when the feature flag is removed.
 */
export function getForApiUrl(overrides: Pick<UniswapUrlOverrides, 'forApiUrlOverride'>): string {
  return (
    overrides.forApiUrlOverride ||
    (getFeatureFlag(FeatureFlags.ForUrlMigration)
      ? getMigratedForApiUrl()
      : getCloudflareApiBaseUrl({ flow: TrafficFlows.FOR, postfix: 'v2/FOR.v1.FORService' }))
  )
}

export function getUniswapServiceUrls(overrides: UniswapUrlOverrides): UniswapServiceUrls {
  const embeddedWalletHostname =
    isE2eTestEnv() || isDevEnv() ? 'dev.ew.unihq.org' : isBetaEnv() ? 'app.corn-staging.com' : UNISWAP_WEB_HOSTNAME

  return {
    amplitudeProxyUrl:
      overrides.amplitudeProxyUrlOverride ||
      getCloudflareApiBaseUrl({ flow: TrafficFlows.Metrics, postfix: 'v1/amplitude-proxy' }),

    apiBaseUrl: overrides.apiBaseUrlOverride || getCloudflareApiBaseUrl(),

    apiBaseUrlV2: overrides.apiBaseUrlV2Override || getCloudflareApiBaseUrl({ postfix: 'v2' }),

    // Dev and staging both use the staging compliance backend; e2e and prod use prod.
    complianceApiBaseUrl:
      !isE2eTestEnv() && (isDevEnv() || isBetaEnv())
        ? STAGING_ENTRY_GATEWAY_API_BASE_URL
        : PROD_ENTRY_GATEWAY_API_BASE_URL,

    dataApiBaseUrlV2:
      overrides.apiBaseUrlV2Override || getCloudflareApiBaseUrl({ flow: TrafficFlows.DataApi, postfix: 'v2' }),

    dataApiServiceUrl: getCloudflareApiBaseUrl({ postfix: 'v2/data.v1.DataApiService' }),

    embeddedWalletHostname,

    embeddedWalletUrl: `https://${embeddedWalletHostname}`,

    graphQLUrl:
      overrides.graphqlUrlOverride || getCloudflareApiBaseUrl({ flow: TrafficFlows.GraphQL, postfix: 'v1/graphql' }),

    liquidityServiceUrl:
      overrides.liquidityServiceUrlOverride ||
      (isE2eTestEnv()
        ? PROD_LIQUIDITY_SERVICE_URL
        : isDevEnv() || isBetaEnv()
          ? STAGING_LIQUIDITY_SERVICE_URL
          : PROD_LIQUIDITY_SERVICE_URL),

    passkeysManagementUrl: `https://${embeddedWalletHostname}/manage/passkey`,

    privyEmbeddedWalletUrl: isE2eTestEnv()
      ? PROD_ENTRY_GATEWAY_API_BASE_URL
      : isBetaEnv()
        ? STAGING_ENTRY_GATEWAY_API_BASE_URL
        : isDevEnv()
          ? DEV_ENTRY_GATEWAY_API_BASE_URL
          : PROD_ENTRY_GATEWAY_API_BASE_URL,

    // Privy REST endpoints
    // Docs: https://docs.privy.io/guide/api/encrypted-authorization-keys
    privyEncryptedAuthorizationKeysUrl: `https://privy.${embeddedWalletHostname}/api/v1/encrypted_authorization_keys`,

    scantasticApiUrl:
      overrides.scantasticApiUrlOverride ||
      getCloudflareApiBaseUrl({ flow: TrafficFlows.Scantastic, postfix: 'v2/scantastic' }),

    // On web, proxy through same-origin "/config" — the BFF (Hono) rewrites to the real Cloudflare URL.
    statsigProxyUrl:
      overrides.statsigProxyUrlOverride ||
      (isWebApp ? '/config' : getCloudflareApiBaseUrl({ flow: TrafficFlows.Gating, postfix: 'v1/statsig-proxy' })),

    tradingApiUrl: overrides.tradingApiUrlOverride || getCloudflareApiBaseUrl({ flow: TrafficFlows.TradingApi }),
  }
}
