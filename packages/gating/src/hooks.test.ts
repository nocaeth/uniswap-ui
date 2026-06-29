import { FeatureFlags } from '@universe/gating/src/flags'
import { getFeatureFlag, getFeatureFlagWithExposureLoggingDisabled } from '@universe/gating/src/hooks'
import { FORCE_DISABLED_FLAGS, FORCE_ENABLED_FLAGS } from '@universe/gating/src/pinnedFeatureFlags'
import { getStatsigClient } from '@universe/gating/src/sdk/statsig'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@universe/gating/src/sdk/statsig', () => ({
  getStatsigClient: vi.fn(),
}))

describe('feature flag pinning', () => {
  const sortFlags = (flags: FeatureFlags[]): FeatureFlags[] =>
    [...flags].sort((flagA, flagB) => String(flagA).localeCompare(String(flagB)))

  const expectedForceDisabledFlags = sortFlags([
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

  const expectedForceEnabledFlags = sortFlags([FeatureFlags.BatchedSwaps, FeatureFlags.LiquidityBatchedTransactions])

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the Gnosis pinned flag contract explicit', () => {
    expect(sortFlags(Array.from(FORCE_DISABLED_FLAGS))).toEqual(expectedForceDisabledFlags)
    expect(sortFlags(Array.from(FORCE_ENABLED_FLAGS))).toEqual(expectedForceEnabledFlags)
  })

  it('honors force-enabled flags in non-hook accessors', () => {
    vi.mocked(getStatsigClient).mockReturnValue({
      checkGate: vi.fn(() => false),
    } as unknown as ReturnType<typeof getStatsigClient>)

    for (const flag of FORCE_ENABLED_FLAGS) {
      expect(getFeatureFlag(flag)).toBe(true)
      expect(getFeatureFlagWithExposureLoggingDisabled(flag)).toBe(true)
    }
  })

  it('honors force-disabled flags before Statsig values', () => {
    vi.mocked(getStatsigClient).mockReturnValue({
      checkGate: vi.fn(() => true),
    } as unknown as ReturnType<typeof getStatsigClient>)

    for (const flag of FORCE_DISABLED_FLAGS) {
      expect(getFeatureFlag(flag)).toBe(false)
      expect(getFeatureFlagWithExposureLoggingDisabled(flag)).toBe(false)
    }
  })
})
