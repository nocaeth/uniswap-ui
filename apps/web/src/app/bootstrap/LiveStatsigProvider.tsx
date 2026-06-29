import { getDeviceId } from '@amplitude/analytics-browser'
import { datadogRum } from '@datadog/browser-rum'
import { isDevEnv, localDevDatadogEnabled } from '@universe/environment'
import type { StatsigUser } from '@universe/gating'
import { type PropsWithChildren, useCallback, useEffect, useMemo } from 'react'
import { StatsigProviderWrapper } from 'uniswap/src/features/gating/StatsigProviderWrapper'
import { initializeDatadog } from 'uniswap/src/utils/datadog'
// oxlint-disable-next-line no-restricted-imports -- custom useAccount hook requires statsig
import { useAccount } from 'wagmi'
import { getConfig } from '~/config'

export function LiveStatsigProvider({ children }: PropsWithChildren): JSX.Element {
  const account = useAccount()
  const connectorType = account.connector?.type
  const connectorName = account.connector?.name
  const connectorId = account.connector?.id

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
      type: connectorType,
      name: connectorName,
      rdns: connectorId,
      address: account.address,
      status: account.status,
    })
  }, [account.address, account.status, connectorId, connectorName, connectorType])

  const onStatsigInit = useCallback((): void => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!isDevEnv() || localDevDatadogEnabled) {
      initializeDatadog('web').catch(() => undefined)
    }
  }, [])

  return (
    <StatsigProviderWrapper user={statsigUser} onInit={onStatsigInit}>
      {children}
    </StatsigProviderWrapper>
  )
}
