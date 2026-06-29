import { FeatureFlagClient, FeatureFlags, getFeatureFlagName } from '@universe/gating/src/flags'

// Gnosis-only build: flags pinned OFF regardless of Statsig so behavior cannot change
// under the deployment.
//
// V2EndpointsPools/Tokens: the self-hosted analytics adapter serves Explore (tokens and
// pools) only via the V1 GraphQL path. It does not implement the V2 Data API endpoints
// for them. Positions are intentionally not pinned because the adapter implements V2
// ListPositions/GetPosition.
//
// RWA flags: real-world assets do not exist on Gnosis, so the RWA UX is removed.
export const FORCE_DISABLED_FLAGS = new Set<FeatureFlags>([
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

// Gnosis-only build: flags pinned ON regardless of Statsig. Atomic batching is the main
// UX win for Safe/DAO users, and the actual batch still only fires when the connected
// wallet advertises EIP-5792 capability.
export const FORCE_ENABLED_FLAGS = new Set<FeatureFlags>([
  FeatureFlags.BatchedSwaps,
  FeatureFlags.LiquidityBatchedTransactions,
])

export function getPinnedFeatureFlagValue(flag: FeatureFlags): boolean | undefined {
  if (FORCE_DISABLED_FLAGS.has(flag)) {
    return false
  }
  if (FORCE_ENABLED_FLAGS.has(flag)) {
    return true
  }
  return undefined
}

const FORCE_DISABLED_WEB_FLAG_NAMES = new Set(
  Array.from(FORCE_DISABLED_FLAGS, (flag) => getFeatureFlagName(flag, FeatureFlagClient.Web)),
)

const FORCE_ENABLED_WEB_FLAG_NAMES = new Set(
  Array.from(FORCE_ENABLED_FLAGS, (flag) => getFeatureFlagName(flag, FeatureFlagClient.Web)),
)

export function getPinnedWebFeatureFlagValue(name: string): boolean | undefined {
  if (FORCE_DISABLED_WEB_FLAG_NAMES.has(name)) {
    return false
  }
  if (FORCE_ENABLED_WEB_FLAG_NAMES.has(name)) {
    return true
  }
  return undefined
}
