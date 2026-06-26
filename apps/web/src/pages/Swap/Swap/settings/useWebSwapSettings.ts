import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { useMemo } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { chainIdToPlatform } from 'uniswap/src/features/platforms/utils/chains'
import { SwapDeadline } from 'uniswap/src/features/transactions/components/settings/settingsConfigurations/deadline/SwapDeadline'
import { filterSettingsByPlatformAndTradeRouting } from 'uniswap/src/features/transactions/components/settings/utils'
import { Slippage } from 'uniswap/src/features/transactions/swap/components/SwapFormSettings/settingsConfigurations/slippage/Slippage/Slippage'
import { TradeRoutingPreference } from 'uniswap/src/features/transactions/swap/components/SwapFormSettings/settingsConfigurations/TradeRoutingPreference/TradeRoutingPreference'
import { useSwapFormStoreDerivedSwapInfo } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { OneClickSwap } from '~/pages/Swap/Swap/settings/OneClickSwap'
import { useAppSelector } from '~/state/hooks'
import { useMultichainContext } from '~/state/multichain/useMultichainContext'
import { selectIsAtomicBatchingSupported } from '~/state/walletCapabilities/reducer'

const DEFAULT_SETTINGS = [Slippage, SwapDeadline, TradeRoutingPreference]

export function useWebSwapSettings() {
  const batchSwapEnabled = useFeatureFlag(FeatureFlags.BatchedSwaps)
  const isAtomicBatchingSupported = useAppSelector(selectIsAtomicBatchingSupported)
  const { chainId } = useMultichainContext()
  const tradeRouting = useSwapFormStoreDerivedSwapInfo((s) => s.trade.trade?.routing)

  return useMemo(() => {
    const canBatch = batchSwapEnabled && isAtomicBatchingSupported
    const baseSettings = canBatch ? [...DEFAULT_SETTINGS, OneClickSwap] : DEFAULT_SETTINGS

    // Gnosis only runs Uniswap V3 (no V2/V4/UniswapX), so the routing-preference setting
    // doesn't apply — hide it.
    const allSettings =
      chainId === UniverseChainId.Gnosis
        ? baseSettings.filter((setting) => setting !== TradeRoutingPreference)
        : baseSettings

    // Filter settings based on current platform
    if (chainId) {
      const platform = chainIdToPlatform(chainId)
      return filterSettingsByPlatformAndTradeRouting(allSettings, { platform, tradeRouting })
    }

    // If no chainId, return all settings (fallback)
    return allSettings
  }, [batchSwapEnabled, isAtomicBatchingSupported, chainId, tradeRouting])
}
