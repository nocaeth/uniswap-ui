import { Trans } from 'react-i18next'
import { Text } from 'ui/src'

export function PrivacyPolicyNotice() {
  return (
    <Text variant="body4" color="$neutral3" textAlign="center">
      <Trans
        i18nKey="wallet.connectingAgreement"
        components={{
          termsLink: <Text color="$neutral3" fontSize="$micro" lineHeight="$micro" />,
          privacyLink: <Text color="$neutral3" fontSize="$micro" lineHeight="$micro" />,
        }}
      />
    </Text>
  )
}
