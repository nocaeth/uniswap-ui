import { StatsigClientEventCallback, StatsigLoadingStatus } from '@statsig/client-core'
import { DynamicConfigKeys } from '@universe/gating/src/configs'
import { ExperimentProperties, Experiments } from '@universe/gating/src/experiments'
import { FeatureFlags, getFeatureFlagName } from '@universe/gating/src/flags'
import {
  getStatsigClient,
  TypedReturn,
  useDynamicConfig,
  useExperiment,
  useFeatureGate,
  useGateValue,
  useLayer,
  useStatsigClient,
} from '@universe/gating/src/sdk/statsig'
import { useEffect, useMemo, useState } from 'react'
import { logger } from 'utilities/src/logger/logger'

// Gnosis-only build: flags pinned OFF regardless of Statsig so behaviour can't change
// out from under the deployment.
//
// V2EndpointsPools/Tokens: the self-hosted analytics adapter serves Explore (tokens &
// pools) only via the V1 GraphQL path — it does not implement the V2 Data API endpoints
// for them. If Uniswap flips these ON, the UI would call V2 endpoints the adapter lacks
// and Explore would break. (Positions are intentionally NOT pinned — the adapter DOES
// implement V2 ListPositions/GetPosition.)
//
// RWA* (real-world assets: stocks/commodities/ETFs): no such assets exist on Gnosis, so
// the entire RWA UX is removed (Explore category chips + asset-shelf carousel, the RWA
// token-selector categories, RWA search sections, and RWA token-detail surfaces). Pinning
// OFF reverts to the well-tested legacy non-RWA path everywhere.
const FORCE_DISABLED_FLAGS = new Set<FeatureFlags>([
  FeatureFlags.V2EndpointsPools,
  FeatureFlags.V2EndpointsTokens,
  FeatureFlags.RWAUX,
  FeatureFlags.RWAUXExplore,
  FeatureFlags.RWAUXExploreCarousel,
  FeatureFlags.RwaUxTokenSelector,
  FeatureFlags.RwaUxTokenSelectorCategoryLabels,
  FeatureFlags.RwaUxSearch,
  FeatureFlags.RwaUxSearchTop24hSection,
  FeatureFlags.RWATdp,
  FeatureFlags.RWATdpRelatedTokens,
  FeatureFlags.RWATdpSiblings,
  FeatureFlags.RWACoinGeckoData,
])

// Gnosis-only build: flags pinned ON regardless of Statsig (the deployment has no Statsig
// config, so these would otherwise default OFF). Atomic batching is the main UX win for the
// Safe/DAO users this fork targets — it collapses approve + Permit2 + swap (or LP approve +
// mint) into a single wallet_sendCalls. Pinning ON is safe: the actual batch still only fires
// when the connected wallet advertises EIP-5792 capability (getCanBatchTransactions), so EOAs
// without it keep the unchanged sequential flow.
const FORCE_ENABLED_FLAGS = new Set<FeatureFlags>([
  FeatureFlags.BatchedSwaps,
  FeatureFlags.LiquidityBatchedTransactions,
])

export function useFeatureFlag(flag: FeatureFlags): boolean {
  const name = getFeatureFlagName(flag)
  const value = useGateValue(name)
  if (FORCE_DISABLED_FLAGS.has(flag)) {
    return false
  }
  if (FORCE_ENABLED_FLAGS.has(flag)) {
    return true
  }
  return value
}

export function useFeatureFlagWithLoading(flag: FeatureFlags): { value: boolean; isLoading: boolean } {
  const { isStatsigLoading } = useStatsigClientStatus()
  const name = getFeatureFlagName(flag)
  const { value } = useFeatureGate(name)
  return { value: FORCE_DISABLED_FLAGS.has(flag) ? false : value, isLoading: isStatsigLoading }
}

export function getFeatureFlag(flag: FeatureFlags): boolean {
  if (FORCE_DISABLED_FLAGS.has(flag)) {
    return false
  }
  try {
    const name = getFeatureFlagName(flag)
    return getStatsigClient().checkGate(name)
  } catch (e) {
    logger.debug('gating/hooks.ts', 'getFeatureFlag', JSON.stringify({ e }))
    return false
  }
}

export function useFeatureFlagWithExposureLoggingDisabled(flag: FeatureFlags): boolean {
  const name = getFeatureFlagName(flag)
  const value = useGateValue(name, { disableExposureLog: true })
  return FORCE_DISABLED_FLAGS.has(flag) ? false : value
}

export function getFeatureFlagWithExposureLoggingDisabled(flag: FeatureFlags): boolean {
  if (FORCE_DISABLED_FLAGS.has(flag)) {
    return false
  }
  const name = getFeatureFlagName(flag)
  return getStatsigClient().checkGate(name, { disableExposureLog: true })
}

export function useExperimentGroupNameWithLoading(experiment: Experiments): {
  value: string | null
  isLoading: boolean
} {
  const { isStatsigLoading } = useStatsigClientStatus()
  const statsigExperiment = useExperiment(experiment)
  return { value: statsigExperiment.groupName, isLoading: isStatsigLoading }
}

export function useExperimentGroupName(experiment: Experiments): string | null {
  const { groupName } = useExperiment(experiment)
  return groupName
}

export function useExperimentValue<
  Exp extends keyof ExperimentProperties,
  Param extends ExperimentProperties[Exp],
  ValType,
>({
  experiment,
  param,
  defaultValue,
  customTypeGuard,
}: {
  experiment: Exp
  param: Param
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const statsigExperiment = useExperiment(experiment)
  const value = statsigExperiment.get(param, defaultValue)
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function getExperimentValue<
  Exp extends keyof ExperimentProperties,
  Param extends ExperimentProperties[Exp],
  ValType,
>({
  experiment,
  param,
  defaultValue,
  customTypeGuard,
}: {
  experiment: Exp
  param: Param
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const statsigExperiment = getStatsigClient().getExperiment(experiment)
  const value = statsigExperiment.get(param, defaultValue)
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function useExperimentValueWithExposureLoggingDisabled<
  Exp extends keyof ExperimentProperties,
  Param extends ExperimentProperties[Exp],
  ValType,
>({
  experiment,
  param,
  defaultValue,
  customTypeGuard,
}: {
  experiment: Exp
  param: Param
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const statsigExperiment = useExperiment(experiment, { disableExposureLog: true })
  const value = statsigExperiment.get(param, defaultValue)
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function useDynamicConfigValue<
  Conf extends keyof DynamicConfigKeys,
  Key extends DynamicConfigKeys[Conf],
  ValType,
>({
  config,
  key,
  defaultValue,
  customTypeGuard,
}: {
  config: Conf
  key: Key
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const dynamicConfig = useDynamicConfig(config)
  const value = dynamicConfig.get(key, defaultValue)
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function getDynamicConfigValue<
  Conf extends keyof DynamicConfigKeys,
  Key extends DynamicConfigKeys[Conf],
  ValType,
>({
  config,
  key,
  defaultValue,
  customTypeGuard,
}: {
  config: Conf
  key: Key
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const dynamicConfig = getStatsigClient().getDynamicConfig(config)
  const value = dynamicConfig.get(key, defaultValue)
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function getExperimentValueFromLayer<Layer extends string, Exp extends keyof ExperimentProperties, ValType>({
  layerName,
  param,
  defaultValue,
  customTypeGuard,
}: {
  layerName: Layer
  param: ExperimentProperties[Exp]
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const layer = getStatsigClient().getLayer(layerName)
  const value = layer.get(param, defaultValue)
  // we directly get param from layer; these are spread from experiments
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function useExperimentValueFromLayer<Layer extends string, Exp extends keyof ExperimentProperties, ValType>({
  layerName,
  param,
  defaultValue,
  customTypeGuard,
}: {
  layerName: Layer
  param: ExperimentProperties[Exp]
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const layer = useLayer(layerName)
  const value = layer.get(param, defaultValue)
  // we directly get param from layer; these are spread from experiments
  return checkTypeGuard({ value, defaultValue, customTypeGuard })
}

export function checkTypeGuard<ValType>({
  value,
  defaultValue,
  customTypeGuard,
}: {
  value: TypedReturn<ValType>
  defaultValue: ValType
  customTypeGuard?: (x: unknown) => x is ValType
}): ValType {
  const isOfDefaultValueType = (val: unknown): val is ValType => typeof val === typeof defaultValue

  if (customTypeGuard?.(value) || isOfDefaultValueType(value)) {
    return value
  } else {
    return defaultValue
  }
}

export function useStatsigClientStatus(): {
  isStatsigLoading: boolean
  isStatsigReady: boolean
  isStatsigUninitialized: boolean
} {
  const { client } = useStatsigClient()
  const [statsigStatus, setStatsigStatus] = useState<StatsigLoadingStatus>(client.loadingStatus)

  useEffect(() => {
    const handler: StatsigClientEventCallback<'values_updated'> = (event) => {
      setStatsigStatus(event.status)
    }
    client.on('values_updated', handler)
    return () => {
      client.off('values_updated', handler)
    }
  }, [client])

  return useMemo(
    () => ({
      isStatsigLoading: statsigStatus === 'Loading',
      isStatsigReady: statsigStatus === 'Ready',
      isStatsigUninitialized: statsigStatus === 'Uninitialized',
    }),
    [statsigStatus],
  )
}
