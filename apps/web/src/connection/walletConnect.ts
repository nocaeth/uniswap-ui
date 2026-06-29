import { type CreateConnectorFn, createConnector } from 'wagmi'
import { walletConnect } from 'wagmi/connectors'
import { WC_PARAMS } from '~/connection/walletConnectMeta'

export { walletTypeToAmplitudeWalletType, WC_PARAMS } from '~/connection/walletConnectMeta'

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
