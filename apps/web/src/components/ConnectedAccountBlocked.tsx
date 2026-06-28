import { useTranslation } from 'react-i18next'
import { Flex, Text } from 'ui/src'
import { Blocked } from 'ui/src/components/icons/Blocked'
import { Modal } from 'uniswap/src/components/modals/Modal'
import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { useModalInitialState } from '~/hooks/useModalInitialState'
import { ModalState } from '~/hooks/useModalState'

export function ConnectedAccountBlocked({ isOpen, closeModal }: ModalState) {
  const blockedAddress = useModalInitialState(ModalName.BlockedAccount)?.blockedAddress
  const { t } = useTranslation()
  return (
    <Modal name={ModalName.AccountBlocked} isModalOpen={isOpen} onClose={closeModal} padding={0}>
      <Flex centered margin="$spacing32" gap="$spacing24">
        <Flex centered gap="$spacing8">
          <Blocked color="$neutral2" size="$icon.24" />
          <Text variant="heading3">{t('common.blockedAddress')}</Text>
          <Text color="$neutral2" variant="body3">
            {blockedAddress}
          </Text>
        </Flex>
        <Flex centered gap="$spacing8">
          <Text color="$neutral2" variant="body4" textAlign="center">
            {t('common.blocked.reason')}
          </Text>
          <Text color="$neutral2" variant="body4" textAlign="center">
            {t('common.blocked.ifError')}
          </Text>
        </Flex>
      </Flex>
    </Modal>
  )
}

export default ConnectedAccountBlocked
