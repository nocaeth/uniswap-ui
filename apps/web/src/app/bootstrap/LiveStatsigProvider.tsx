import { getDeviceId } from '@amplitude/analytics-browser'
import { datadogRum } from '@datadog/browser-rum'
import { isDevEnv, localDevDatadogEnabled } from '@universe/environment'
import type { StatsigUser } from '@universe/gating'
import { type PropsWithChildren, useEffect, useMemo } from 'react'
import { StatsigProviderWrapper } from 'uniswap/src/features/gating/StatsigProviderWrapper'
import { initializeDatadog } from 'uniswap/src/utils/datadog'
// oxlint-disable-next-line no-restricted-imports -- custom useAccount hook requires statsig
import { useAccount } from 'wagmi'
import { getConfig } from '~/config'

export function LiveStatsigProvider({ children }: PropsWithChildren): JSX.Element {
  const account = useAccount()

  const statsigUser: StatsigUser = useMemo(
    () => ({
      userID: getDeviceId(),
      customIDs: { address: account.address ?? '' },
      custom: {
        appVersion: getConfig().appVersion || 'unknown',
      },
    }),
    [account.address],
  )

  useEffect(() => {
    datadogRum.setUserProperty('connection', {
      type: account.connector?.type,
      name: account.connector?.name,
      rdns: account.connector?.id,
      address: account.address,
      status: account.status,
    })
  }, [account])

  const onStatsigInit = (): void => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!isDevEnv() || localDevDatadogEnabled) {
      initializeDatadog('web').catch(() => undefined)
    }
  }

  return (
    <StatsigProviderWrapper user={statsigUser} onInit={onStatsigInit}>
      {children}
    </StatsigProviderWrapper>
  )
}
