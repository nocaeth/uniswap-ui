import { connect } from '@wagmi/core'
import { useUpdateAtom } from 'jotai/utils'
import { useMemo } from 'react'
import { CONNECTION_PROVIDER_IDS, CONNECTION_PROVIDER_NAMES } from 'uniswap/src/constants/web3'
import { CONNECTOR_ICON_OVERRIDE_MAP } from '~/connection/constants'
import { wagmiConfig } from '~/connection/wagmiConfig'
import { WC_PARAMS } from '~/connection/walletConnectMeta'
import { ConnectionService } from '~/features/wallet/connection/services/IConnectionService'
import { WalletConnectorMeta } from '~/features/wallet/connection/types/WalletConnectorMeta'
import { persistHideMobileAppPromoBannerAtom } from '~/state/application/atoms'

const APPLY_CUSTOM_CONNECTOR_META_MAP = {
  [CONNECTION_PROVIDER_IDS.UNISWAP_WALLET_CONNECT_CONNECTOR_ID]: applyUniswapWalletConnectorMeta,
} as const
const CUSTOM_CONNECTOR_META_TRANSFORMS = __GNOSIS_LEAN_BUILD__ ? [] : Object.values(APPLY_CUSTOM_CONNECTOR_META_MAP)

/**
 * Applies custom connector metadata transformations to the base wallet connector array.
 *
 * Takes a base array of wallet connectors and applies custom transformations for
 * connectors that need special handling beyond standard configuration.
 *
 * Current transformations:
 * - Uniswap Wallet: Adds a new connector to the array
 * - Icon overrides: Applies custom icons from CONNECTOR_ICON_OVERRIDE_MAP
 *
 */
export function applyCustomConnectorMeta(walletConnectors: WalletConnectorMeta[]): WalletConnectorMeta[] {
  return (
    CUSTOM_CONNECTOR_META_TRANSFORMS
      // oxlint-disable-next-line no-shadow
      .reduce((acc, applyCustomConnectorMeta) => applyCustomConnectorMeta(acc), walletConnectors)
      .map((connector) => {
        const iconOverride = CONNECTOR_ICON_OVERRIDE_MAP[connector.name]
        if (iconOverride) {
          return { ...connector, icon: iconOverride }
        }
        return connector
      })
  )
}

// CUSTOM CONNECTOR FUNCTIONS

// =========================================
// Uniswap Wallet Connect
// =========================================
// Lazy-initialized on connection to prevent socket conflicts.
// Standard wagmi initialization creates persistent WebSocket connections
// that can interfere with each other and cause message drops.
export function useUniswapMobileConnectionService(): ConnectionService {
  const setPersistHideMobileAppPromoBanner = useUpdateAtom(persistHideMobileAppPromoBannerAtom)

  return useMemo(
    () => ({
      connect: async () => {
        setPersistHideMobileAppPromoBanner(true)

        // Initialize Uniswap Wallet on click instead of in wagmi config
        // to avoid multiple wallet connect sockets being opened
        // and causing issues with messages getting dropped
        const { uniswapWalletConnect } = await import('~/connection/walletConnect')
        await connect(wagmiConfig, { connector: uniswapWalletConnect() })
        return { connected: true }
      },
    }),
    [setPersistHideMobileAppPromoBanner],
  )
}

export function useWalletConnectConnectionService(): ConnectionService {
  return useMemo(
    () => ({
      connect: async () => {
        const { walletConnect } = await import('wagmi/connectors')
        await connect(wagmiConfig, { connector: walletConnect(WC_PARAMS) })
        return { connected: true }
      },
    }),
    [],
  )
}

const UNISWAP_WALLET_CONNECTOR_META = {
  name: CONNECTION_PROVIDER_NAMES.UNISWAP_WALLET,
  icon: CONNECTOR_ICON_OVERRIDE_MAP[CONNECTION_PROVIDER_NAMES.UNISWAP_WALLET],
  customConnectorId: CONNECTION_PROVIDER_IDS.UNISWAP_WALLET_CONNECT_CONNECTOR_ID,
  isInjected: false,
  analyticsWalletType: 'Wallet Connect',
}
/** Adds a WalletConnectorMeta for the Uniswap Wallet Connect connector. */
function applyUniswapWalletConnectorMeta(walletConnectors: WalletConnectorMeta[]): WalletConnectorMeta[] {
  return [...walletConnectors, UNISWAP_WALLET_CONNECTOR_META]
}
