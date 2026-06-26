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

// Gnosis-only build: the self-hosted analytics adapter serves Explore (tokens & pools)
// only via the V1 GraphQL path — it does not implement the V2 Data API endpoints for
// them. Upstream Uniswap gates that path on these Statsig flags; if Uniswap ever flips
// them ON, the UI would call V2 endpoints the adapter lacks and Explore would break. Pin
// them OFF here so behaviour can't change out from under the deployment. (Positions are
// intentionally NOT pinned — the adapter DOES implement V2 ListPositions/GetPosition.)
const FORCE_DISABLED_FLAGS = new Set<FeatureFlags>([FeatureFlags.V2EndpointsPools, FeatureFlags.V2EndpointsTokens])

export function useFeatureFlag(flag: FeatureFlags): boolean {
  const name = getFeatureFlagName(flag)
  const value = useGateValue(name)
  return FORCE_DISABLED_FLAGS.has(flag) ? false : value
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
