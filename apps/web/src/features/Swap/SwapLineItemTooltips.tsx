import { useTranslation } from 'react-i18next'

/** Shared swap UI copy; consumed outside the limit-order flow (e.g. token details). */
export function FOTTooltipContent() {
  const { t } = useTranslation()
  return <>{t('swap.tokenOwnFees')}</>
}

export function SlippageTooltipContent() {
  const { t } = useTranslation()
  return <>{t('swap.slippage.tooltip')}</>
}

export function SwapFeeTooltipContent({ hasFee }: { hasFee: boolean }) {
  const { t } = useTranslation()
  return <>{hasFee ? t('swap.fees.experience') : t('swap.fees.noFee')}</>
}
