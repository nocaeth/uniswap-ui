import { DynamicConfigs, SwapConfigKey } from '@universe/gating/src/configs'
import {
  EthAsErc20UniswapXProperties,
  Experiments,
  Layers,
  PrivateRpcProperties,
} from '@universe/gating/src/experiments'
import { FeatureFlagClient, FeatureFlags, getFeatureFlagName } from '@universe/gating/src/flags'
import { FORCE_DISABLED_FLAGS, FORCE_ENABLED_FLAGS } from '@universe/gating/src/pinnedFeatureFlags'
import { getStatsigClient } from '@universe/gating/src/sdk/statsig.static'
import { describe, expect, it } from 'vitest'

describe('static web Statsig SDK', () => {
  it('returns pinned Gnosis gate values', () => {
    const client = getStatsigClient()

    for (const flag of FORCE_ENABLED_FLAGS) {
      expect(client.checkGate(getFeatureFlagName(flag, FeatureFlagClient.Web))).toBe(true)
    }
    for (const flag of FORCE_DISABLED_FLAGS) {
      expect(client.checkGate(getFeatureFlagName(flag, FeatureFlagClient.Web))).toBe(false)
    }
  })

  it('returns false for unpinned gates', () => {
    expect(getStatsigClient().checkGate(getFeatureFlagName(FeatureFlags.DummyFlagTest, FeatureFlagClient.Web))).toBe(
      false,
    )
  })

  it('returns caller defaults for experiments', () => {
    const experiment = getStatsigClient().getExperiment(Experiments.PrivateRpc)

    expect(experiment.groupName).toBeNull()
    expect(experiment.get(PrivateRpcProperties.RefundPercent, 12)).toBe(12)
    expect(experiment.get(PrivateRpcProperties.FlashbotsEnabled, true)).toBe(true)
  })

  it('returns caller defaults for dynamic configs', () => {
    const config = getStatsigClient().getDynamicConfig(DynamicConfigs.Swap)

    expect(config.value).toEqual({})
    expect(config.get(SwapConfigKey.TradingApiSwapRequestMs, 2500)).toBe(2500)
    expect(config.get(SwapConfigKey.ChainedActionsUnsupportedChainIds, [1, 10])).toEqual([1, 10])
  })

  it('keeps swap-path gating deterministic', () => {
    const client = getStatsigClient()
    const swapPathFlags = new Map<FeatureFlags, boolean>([
      [FeatureFlags.BatchedSwaps, true],
      [FeatureFlags.CentralizedPrices, false],
      [FeatureFlags.ChainedActions, false],
      [FeatureFlags.ForcePermitTransactions, false],
      [FeatureFlags.GasFeeOverrides, false],
      [FeatureFlags.PortionFields, false],
      [FeatureFlags.SessionsServiceEnabled, false],
      [FeatureFlags.TurnstileSolverEnabled, false],
      [FeatureFlags.HashcashSolverEnabled, false],
      [FeatureFlags.UniRpcEnabled, false],
      [FeatureFlags.UniswapX, false],
    ])

    for (const [flag, expected] of swapPathFlags) {
      expect(client.checkGate(getFeatureFlagName(flag, FeatureFlagClient.Web))).toBe(expected)
    }

    expect(
      client
        .getExperiment(Experiments.EthAsErc20UniswapX)
        .get(EthAsErc20UniswapXProperties.EthAsErc20UniswapXEnabled, false),
    ).toBe(false)
    expect(client.getLayer(Layers.SwapPage).get(EthAsErc20UniswapXProperties.EthAsErc20UniswapXEnabled, false)).toBe(
      false,
    )
    expect(client.getDynamicConfig(DynamicConfigs.Swap).get(SwapConfigKey.TradingApiSwapRequestMs, 2500)).toBe(2500)
  })
})
