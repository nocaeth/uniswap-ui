import type { StatsigClient } from '@universe/gating/src/sdk/statsig.static'
import { getOverrideAdapter } from '@universe/gating/src/sdk/statsig.static'

type GateOverride = [string, boolean]
type ConfigOverride = [string, Record<string, unknown>]

export function isStatsigClientRegistered(): boolean {
  return true
}

export function waitForStatsigReady(): Promise<void> {
  return Promise.resolve()
}

export function getOverrides(_client: StatsigClient): {
  configOverrides: ConfigOverride[]
  gateOverrides: GateOverride[]
} {
  const statsigOverrides = getOverrideAdapter().getAllOverrides()
  const filterNumbers = (value: [string, unknown]): boolean => isNaN(parseInt(value[0], 10))
  const gateOverrides = Object.entries(statsigOverrides.gate).filter(filterNumbers)
  const configOverrides = Object.entries(statsigOverrides.dynamicConfig).filter(filterNumbers)

  return { configOverrides, gateOverrides }
}
