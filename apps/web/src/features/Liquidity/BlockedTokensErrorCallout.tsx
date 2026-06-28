import { useTranslation } from 'react-i18next'
import { ErrorCallout } from '~/components/ErrorCallout'

export const BlockedTokensErrorCallout = ({ blockedTokenSymbols }: { blockedTokenSymbols: string[] }) => {
  const { t } = useTranslation()

  if (blockedTokenSymbols.length === 0) {
    return null
  }

  return (
    <ErrorCallout
      errorMessage={true}
      title={
        blockedTokenSymbols.length > 1
          ? t('token.safety.blocked.title.tokensNotAvailable', {
              tokenSymbol0: blockedTokenSymbols[0],
              tokenSymbol1: blockedTokenSymbols[1],
            })
          : t('token.safety.blocked.title.tokenNotAvailable', { tokenSymbol: blockedTokenSymbols[0] })
      }
      description={
        <>
          {blockedTokenSymbols.length > 1
            ? t('token.safety.warning.blocked.description.default_other')
            : t('token.safety.warning.blocked.description.default_one')}
        </>
      }
    />
  )
}
