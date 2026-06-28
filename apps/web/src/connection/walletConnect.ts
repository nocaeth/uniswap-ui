import { zIndexes } from 'ui/src/theme'
import { type CreateConnectorFn, createConnector } from 'wagmi'
import { walletConnect } from 'wagmi/connectors'
import { getConfig } from '~/config'

const WALLET_CONNECT_PROJECT_ID = getConfig().walletConnectProjectId

export function walletTypeToAmplitudeWalletType(connectionType?: string): string {
  switch (connectionType) {
    case 'injected': {
      return 'Browser Extension'
    }
    case 'walletConnect': {
      return 'Wallet Connect'
    }
    case 'coinbaseWallet': {
      return 'Coinbase Wallet'
    }
    case 'uniswapWalletConnect': {
      return 'Wallet Connect'
    }
    case 'embeddedUniswapWallet': {
      return 'Passkey'
    }
    default: {
      return connectionType ?? 'Network'
    }
  }
}

export const WC_PARAMS = {
  projectId: WALLET_CONNECT_PROJECT_ID,
  metadata: {
    name: 'NOCA',
    description: 'NOCA · Gnosis',
    url: 'https://swap.gno.now',
    icons: ['https://swap.gno.now/favicon.png'],
  },
  qrModalOptions: {
    themeVariables: {
      '--wcm-font-family': '"Inter custom", sans-serif',
      '--wcm-z-index': zIndexes.overlay.toString(),
    },
  },
}

export function uniswapWalletConnect(): CreateConnectorFn {
  return createConnector((config) => {
    const wc = walletConnect({
      ...WC_PARAMS,
      showQrModal: false,
    })(config)

    config.emitter.on('message', ({ type, data }) => {
      if (type === 'display_uri') {
        window.dispatchEvent(new MessageEvent('display_walletconnect_uri', { data }))
      }
    })

    return {
      ...wc,
      id: 'uniswapWalletConnect',
      type: 'uniswapWalletConnect',
      name: 'WalletConnect',
      icon: WC_PARAMS.metadata.icons[0],
    }
  })
}
