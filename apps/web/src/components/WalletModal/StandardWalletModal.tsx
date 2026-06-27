import { useTranslation } from 'react-i18next'
import { Flex, Text } from 'ui/src'
import { WalletModalLayout } from '~/components/WalletModal/WalletModalLayout'
import { WalletOptionsGrid } from '~/components/WalletModal/WalletOptionsGrid'

export function StandardWalletModal(): JSX.Element {
  const { t } = useTranslation()

  const header = (
    <Flex row justifyContent="space-between" width="100%">
      <Text variant="subheading2">{t('common.connectAWallet.button')}</Text>
    </Flex>
  )

  // Gnosis-only: external wallets only — the Uniswap Wallet promo/extension/download
  // section is removed. The grid itself is unchanged from upstream: with the embedded
  // wallet disabled, buildPrimaryConnectorsList already lists injected + WalletConnect +
  // Coinbase, so no separate "other wallets" navigation is needed.
  return (
    <WalletModalLayout header={header}>
      <WalletOptionsGrid showMobileConnector={false} showOtherWallets={false} maxHeight="100vh" opacity={1} />
    </WalletModalLayout>
  )
}
