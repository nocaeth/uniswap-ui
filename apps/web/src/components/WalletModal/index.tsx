import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { MenuStateVariant, useSetMenuCallback } from '~/components/AccountDrawer/menuState'
import { StandardWalletModal } from '~/components/WalletModal/StandardWalletModal'
import { SwitchWalletModal } from '~/components/WalletModal/SwitchWalletModal'

export function WalletModal({ connectOnPlatform }: { connectOnPlatform?: Platform | 'any' }) {
  const onClose = useSetMenuCallback(MenuStateVariant.MAIN)

  if (connectOnPlatform) {
    return <SwitchWalletModal connectOnPlatform={connectOnPlatform} onClose={onClose} />
  }

  return <StandardWalletModal />
}
