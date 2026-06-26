import { Flex, useMedia, WebBottomSheet } from 'ui/src'
import { INTERFACE_NAV_HEIGHT } from 'ui/src/theme'
import { Modal } from 'uniswap/src/components/modals/Modal'
import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { TestID } from 'uniswap/src/test/fixtures/testIDs'
import { DownloadAppsModal } from '~/components/NavBar/DownloadApp/Modal/DownloadApps'
import { useAndroidKeyboardViewportFix } from '~/hooks/useAndroidKeyboardViewportFix'
import { useIOSBodyScrollLock } from '~/hooks/useIOSBodyScrollLock'
import { useModalState } from '~/hooks/useModalState'
import { useAppSelector } from '~/state/hooks'

export function GetTheAppModal() {
  const initialInnerPage = useAppSelector((state) => {
    const modal = state.application.openModal
    return modal?.name === ModalName.GetTheApp ? modal.initialState?.initialInnerPage : undefined
  })
  const showMobileDownload = initialInnerPage === 'mobile'

  const { isOpen, closeModal } = useModalState(ModalName.GetTheApp)
  // No-op on iOS/desktop; keeps the sheet on-screen if the Android soft keyboard opens.
  useAndroidKeyboardViewportFix(isOpen)

  const media = useMedia()
  const isSheet = media.md

  const keyboardHeight = useIOSBodyScrollLock(isOpen)

  const content = (
    <Flex data-testid={TestID.DownloadUniswapModal} position="relative" userSelect="none" width="100%">
      <DownloadAppsModal onClose={closeModal} initialInnerPage={showMobileDownload ? 'mobile' : undefined} />
    </Flex>
  )

  // Render WebBottomSheet directly on mobile: <Modal>'s outer Dialog focus trap
  // fights the inner Sheet's on iOS Safari and breaks keyboard handling.
  if (isSheet) {
    return (
      <WebBottomSheet
        isOpen={isOpen}
        onClose={closeModal}
        maxHeight={`calc(100dvh - ${INTERFACE_NAV_HEIGHT}px)`}
        px="$spacing24"
        pb="$spacing24"
      >
        <Flex pb={keyboardHeight ? `${keyboardHeight}px` : undefined}>{content}</Flex>
      </WebBottomSheet>
    )
  }

  return (
    <Modal
      skipLogImpression
      name={ModalName.DownloadApp}
      isModalOpen={isOpen}
      isDismissible
      maxWidth={480}
      onClose={closeModal}
      padding="$spacing32"
    >
      {content}
    </Modal>
  )
}

export default GetTheAppModal
