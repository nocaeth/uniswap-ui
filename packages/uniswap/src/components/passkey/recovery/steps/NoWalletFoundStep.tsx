import type { TFunction } from 'i18next'
import { Button, Flex, ModalCloseIcon, Text } from 'ui/src'
import { AlertTriangleFilled } from 'ui/src/components/icons/AlertTriangleFilled'
import { IconBox } from 'uniswap/src/components/passkey/recovery/IconBox'
import { StepHeader } from 'uniswap/src/components/passkey/recovery/StepHeader'
import { TestID } from 'uniswap/src/test/fixtures/testIDs'

interface NoWalletFoundStepProps {
  t: TFunction
  handleClose: () => void
  onCreateAccount?: () => void
}

export function NoWalletFoundStep({ t, handleClose, onCreateAccount }: NoWalletFoundStepProps): JSX.Element {
  return (
    <Flex alignItems="center" width="100%">
      <StepHeader
        hideBack
        headerActions={
          <Flex row gap="$spacing12" alignItems="center">
            <ModalCloseIcon testId={TestID.StepHeaderClose} size="$icon.20" onClose={handleClose} />
          </Flex>
        }
        onBack={handleClose}
        onClose={handleClose}
      />
      <Flex gap="$gap24" alignItems="center">
        <IconBox>
          <AlertTriangleFilled size="$icon.24" color="$neutral1" />
        </IconBox>

        <Flex gap="$gap8" alignItems="center" width="100%">
          <Text variant="subheading1" textAlign="center">
            {t('account.passkey.backupLogin.noWalletFound.title')}
          </Text>
          <Text variant="body2" color="$neutral2" textAlign="center">
            {t('account.passkey.backupLogin.noWalletFound.body')}
          </Text>
          <Text variant="body2" color="$neutral2" textAlign="center">
            {t('account.passkey.backupLogin.noWalletFound.cta.prefix')}
            <Text
              variant="body2"
              color={onCreateAccount ? '$accent1' : '$neutral2'}
              cursor={onCreateAccount ? 'pointer' : 'default'}
              onPress={onCreateAccount}
            >
              {t('account.passkey.backupLogin.noWalletFound.cta.linkText')}
            </Text>
            .
          </Text>
        </Flex>

        <Flex row alignSelf="stretch">
          <Button size="medium" emphasis="secondary" onPress={handleClose}>
            {t('common.close')}
          </Button>
        </Flex>
      </Flex>
    </Flex>
  )
}
