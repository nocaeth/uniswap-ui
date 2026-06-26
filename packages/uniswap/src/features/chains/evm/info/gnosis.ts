import { Token } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { SwapConfigKey } from '@universe/gating'
import { GNOSIS_LOGO } from 'ui/src/assets'
import { CHAIN_ID_TO_URL_PARAM } from 'uniswap/src/features/chains/chainUrlParam'
import { DEFAULT_NATIVE_ADDRESS_LEGACY, DEFAULT_RETRY_OPTIONS } from 'uniswap/src/features/chains/evm/rpc'
import { buildChainTokens } from 'uniswap/src/features/chains/evm/tokens'
import {
  GqlChainId,
  NetworkLayer,
  RPCType,
  UniverseChainId,
  UniverseChainInfo,
} from 'uniswap/src/features/chains/types'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { ElementName } from 'uniswap/src/features/telemetry/constants'
import { gnosis } from 'wagmi/chains'

// Wrapped native (WXDAI) doubles as the most liquid USD stablecoin on Gnosis, so it
// is the primary spot-price stablecoin. USDC.e is Circle's bridged USDC.
const WXDAI_ADDRESS = '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'

// Allow pointing the Gnosis RPC at a self-hosted node or a local fork (e.g. anvil)
// via REACT_APP_GNOSIS_RPC_URL, without code changes. Falls back to public endpoints.
const GNOSIS_RPC_OVERRIDE = process.env['REACT_APP_GNOSIS_RPC_URL']

const tokens = buildChainTokens({
  stables: {
    // WXDAI as primary: deepest USD-pegged liquidity on Gnosis V3
    WXDAI: new Token(UniverseChainId.Gnosis, WXDAI_ADDRESS, 18, 'WXDAI', 'Wrapped XDAI'),
    USDC: new Token(UniverseChainId.Gnosis, '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0', 6, 'USDC.e', 'Bridged USDC'),
    USDT: new Token(UniverseChainId.Gnosis, '0x4eCAbA5870353805a9f068101A8e0e64dD33Cd47', 6, 'USDT', 'Tether USD'),
  },
  primaryStablecoin: 'WXDAI',
})

export const GNOSIS_CHAIN_INFO = {
  ...gnosis,
  id: UniverseChainId.Gnosis,
  platform: Platform.EVM,
  assetRepoNetworkName: 'xdai',
  backendChain: {
    // Uniswap's GraphQL backend does not support Gnosis. Analytics is served by our
    // self-hosted Envio adapter, so this value is inert (backendSupported: false).
    chain: GraphQLApi.Chain.Ethereum as GqlChainId,
    backendSupported: false,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: 600000,
  bridge: 'https://bridge.gnosischain.com/',
  docs: 'https://docs.gnosischain.com/',
  elementName: ElementName.ChainGnosis,
  explorer: {
    name: 'GnosisScan',
    url: 'https://gnosisscan.io/',
  },
  interfaceName: 'gnosis',
  searchAliases: ['xdai', 'gnosischain'],
  label: 'Gnosis Chain',
  logo: GNOSIS_LOGO,
  name: 'Gnosis',
  nativeCurrency: {
    name: 'xDAI',
    symbol: 'XDAI',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    logo: GNOSIS_LOGO,
  },
  networkLayer: NetworkLayer.L1,
  blockTimeMs: 5000,
  pendingTransactionsRetryOptions: DEFAULT_RETRY_OPTIONS,
  rpcUrls: {
    [RPCType.Default]: { http: [GNOSIS_RPC_OVERRIDE ?? 'https://rpc.gnosischain.com'] },
    [RPCType.Public]: { http: [GNOSIS_RPC_OVERRIDE ?? 'https://gnosis.drpc.org'] },
    [RPCType.Interface]: { http: [GNOSIS_RPC_OVERRIDE ?? 'https://rpc.gnosischain.com'] },
    [RPCType.Fallback]: {
      http: GNOSIS_RPC_OVERRIDE ? [GNOSIS_RPC_OVERRIDE] : ['https://gnosis.drpc.org', 'https://rpc.gnosis.gateway.fm'],
    },
  },
  tokens,
  statusPage: undefined,
  // Gnosis only runs Uniswap V3; UR version must match our deployed UniversalRouter.
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0],
  supportsV4: false,
  supportsNFTs: false,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.Gnosis],
  wrappedNativeCurrency: {
    name: 'Wrapped XDAI',
    symbol: 'WXDAI',
    decimals: 18,
    address: WXDAI_ADDRESS,
  },
  // xDAI is ~$1; reserve a small native buffer for gas (values are 10^-4 of native).
  gasConfig: {
    send: {
      configKey: SwapConfigKey.GenericL2SendMinGasAmount,
      default: 20, // .002 xDAI
    },
    swap: {
      configKey: SwapConfigKey.GenericL2SwapMinGasAmount,
      default: 100, // .01 xDAI
    },
  },
  tradingApiPollingIntervalMs: 250,
} as const satisfies UniverseChainInfo
