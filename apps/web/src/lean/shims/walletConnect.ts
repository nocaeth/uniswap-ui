import type { CreateConnectorFn } from 'wagmi'

export function walletTypeToAmplitudeWalletType(connectionType?: string): string {
  switch (connectionType) {
    case 'injected': {
      return 'Browser Extension'
    }
    case 'safe': {
      return 'Safe'
    }
    default: {
      return connectionType ?? 'Network'
    }
  }
}

export const WC_PARAMS = {
  projectId: '',
  metadata: {
    name: 'NOCA',
    description: 'NOCA · Gnosis',
    url: 'https://swap.gno.now',
    icons: ['https://swap.gno.now/favicon.png'],
  },
}

export function uniswapWalletConnect(): CreateConnectorFn {
  throw new Error('WalletConnect is disabled in Gnosis lean builds.')
}
