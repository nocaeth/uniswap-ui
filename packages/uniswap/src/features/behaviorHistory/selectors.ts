import { UniswapState } from 'uniswap/src/state/uniswapReducer'

export const selectHasViewedBridgingBanner = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasViewedBridgingBanner === true

export const selectHasDismissedBridgingWarning = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasDismissedBridgingWarning === true

export const selectHasDismissedLowNetworkTokenWarning = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasDismissedLowNetworkTokenWarning === true

export const selectHasViewedContractAddressExplainer = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasViewedContractAddressExplainer === true

export const selectHasShownMismatchToast = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasShownMismatchToast === true

export const selectHasDismissedUniswapWrapped2025Banner = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasDismissedUniswapWrapped2025Banner === true

export const selectHasDismissedCrosschainSwapsPromoBanner = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasDismissedCrosschainSwapsPromoBanner === true

export const selectHasDismissedPoolsBalanceCoachmark = (state: UniswapState): boolean =>
  state.uniswapBehaviorHistory.hasDismissedPoolsBalanceCoachmark === true
