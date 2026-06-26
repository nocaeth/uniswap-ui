import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import React, { PropsWithChildren, useCallback, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router'
import { UniswapProvider } from 'uniswap/src/contexts/UniswapContext'
import { useOnchainDisplayName } from 'uniswap/src/features/accounts/useOnchainDisplayName'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { toGraphQLChain } from 'uniswap/src/features/chains/utils'
import { useNavigateToNftExplorerLink } from 'uniswap/src/features/nfts/hooks/useNavigateToNftExplorerLink'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { useSetActiveChainId } from 'uniswap/src/features/smartWallet/delegation/hooks/useSetActiveChainId'
import { DelegatedState } from 'uniswap/src/features/smartWallet/delegation/types'
import { useHasAccountMismatchCallback } from 'uniswap/src/features/smartWallet/mismatch/hooks'
import { MismatchContextProvider } from 'uniswap/src/features/smartWallet/mismatch/MismatchContext'
import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { useGetCanSignPermits } from 'uniswap/src/features/transactions/hooks/useGetCanSignPermits'
import { CurrencyField } from 'uniswap/src/types/currency'
import { currencyIdToAddress, currencyIdToChain } from 'uniswap/src/utils/currencyId'
import { getPoolDetailsURL, type TdpChainSelection } from 'uniswap/src/utils/linking'
import { useEvent, usePrevious } from 'utilities/src/react/hooks'
import { noop } from 'utilities/src/react/noop'
import { getTokenDetailsURL } from '~/appGraphql/data/util'
import { MenuStateVariant, useMenuState } from '~/components/AccountDrawer/menuState'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useConnectionStatus } from '~/features/accounts/store/hooks'
import { useAccountsStoreContext } from '~/features/accounts/store/provider'
import { useAccount } from '~/hooks/useAccount'
import { useEthersProvider } from '~/hooks/useEthersProvider'
import { useEthersSigner } from '~/hooks/useEthersSigner'
import { useModalState } from '~/hooks/useModalState'
import { useOneClickSwapSetting } from '~/pages/Swap/Swap/settings/OneClickSwap'
import { serializeSwapAddressesToURLParameters } from '~/pages/Swap/Swap/state/tradeQueryParams'
import { SwitchNetworkAction } from '~/state/popups/types'
import { useHasAlternateGasFeesByChainIdCallback } from '~/state/walletCapabilities/hooks/useHasAlternateGasFees'
import { useIsAtomicBatchingSupportedByChainIdCallback } from '~/state/walletCapabilities/hooks/useIsAtomicBatchingSupportedByChain'
import { useHasMismatchCallback, useShowMismatchToast } from '~/state/walletCapabilities/hooks/useMismatchAccount'
import { getTdpChainQueryParam } from '~/utils/params/chainQueryParam'
import { showSwitchNetworkNotification } from '~/utils/showSwitchNetworkNotification'

// Adapts useEthersProvider to fit uniswap context hook shape
function useWebProvider(chainId: number) {
  return useEthersProvider({ chainId })
}

export function WebUniswapProvider({ children }: PropsWithChildren): JSX.Element {
  return (
    <MismatchContextWrapper>
      <WebUniswapProviderInner>{children}</WebUniswapProviderInner>
    </MismatchContextWrapper>
  )
}

// Abstracts web-specific transaction flow objects for usage in cross-platform flows in the `uniswap` package.
function WebUniswapProviderInner({ children }: PropsWithChildren) {
  const signer = useEthersSigner()
  const accountDrawer = useAccountDrawer()
  const navigate = useNavigate()

  const { closeModal: closeSearchModal } = useModalState(ModalName.Search)

  const navigateToSwapFlow = useCallback(
    ({
      inputCurrencyId,
      outputCurrencyId,
      exactCurrencyField,
      exactAmountToken,
    }: {
      inputCurrencyId?: string
      outputCurrencyId?: string
      exactCurrencyField?: CurrencyField
      exactAmountToken?: string
    }) => {
      const queryParams = serializeSwapAddressesToURLParameters({
        inputTokenAddress: inputCurrencyId ? currencyIdToAddress(inputCurrencyId) : undefined,
        outputTokenAddress: outputCurrencyId ? currencyIdToAddress(outputCurrencyId) : undefined,
        chainId: inputCurrencyId ? currencyIdToChain(inputCurrencyId) : undefined,
        outputChainId: outputCurrencyId ? currencyIdToChain(outputCurrencyId) : undefined,
        exactCurrencyField,
        exactAmountToken,
      })
      navigate(`/swap${queryParams}`)
      closeSearchModal()
      accountDrawer.close()
    },
    [navigate, closeSearchModal, accountDrawer],
  )

  const navigateToPoolDetails = useCallback(
    ({ poolId, chainId }: { poolId: Address; chainId: UniverseChainId }) => {
      const url = getPoolDetailsURL(poolId, chainId)
      navigate(url)
      closeSearchModal()
    },
    [navigate, closeSearchModal],
  )

  // Gnosis: fiat on-ramp / buy / send / receive flows removed. These props are still
  // required by the UniswapProvider contract, so they are wired to safe no-ops.
  const navigateToFiatOnRamp = useCallback(() => {}, [])

  const navigateToBuyOrReceiveWithEmptyWallet = useCallback(() => {}, [])

  const navigateToSendFlow = useCallback(() => {}, [])

  const navigateToReceive = useCallback(() => {}, [])

  // no-op until we have a share token screen on web
  const handleShareToken = useCallback((_: { currencyId: string }) => {
    noop()
  }, [])

  const navigateToTokenDetails = useCallback(
    (currencyId: string, chainSelection?: TdpChainSelection) => {
      const tokenChainId = currencyIdToChain(currencyId)
      const url = getTokenDetailsURL({
        address: currencyIdToAddress(currencyId),
        chain: tokenChainId ? toGraphQLChain(tokenChainId) : undefined,
        chainQueryParam: getTdpChainQueryParam({ selection: chainSelection, tokenChainId }),
      })
      navigate(url)
      closeSearchModal()
      accountDrawer.close()
    },
    [navigate, closeSearchModal, accountDrawer],
  )

  const getHasMismatch = useHasAccountMismatchCallback()
  const isPermitMismatchUxEnabled = useFeatureFlag(FeatureFlags.EnablePermitMismatchUX)
  const getIsUniswapXSupported = useEvent((innerChainId?: UniverseChainId) => {
    if (isPermitMismatchUxEnabled) {
      return !getHasMismatch(innerChainId)
    }
    return true
  })
  const getCanSignPermits = useGetCanSignPermits()

  // Portfolio/profile pages are not part of this Gnosis-only build, so viewing an
  // external address' profile is a no-op beyond dismissing the search modal.
  const navigateToExternalProfile = useCallback(() => {
    closeSearchModal()
  }, [closeSearchModal])

  const { openModal } = useModalState(ModalName.DelegationMismatch)

  const handleOpenUniswapXUnsupportedModal = useEvent(() => {
    openModal()
  })

  const isBatchedSwapsFlagEnabled = useFeatureFlag(FeatureFlags.BatchedSwaps)
  const isAtomicBatchingSupportedByChain = useIsAtomicBatchingSupportedByChainIdCallback()

  const { enabled: isOneClickSwapSettingEnabled } = useOneClickSwapSetting()
  // oxlint-disable-next-line typescript/no-duplicate-type-constituents no-shadow -- biome-parity: oxlint is stricter here
  const getCanBatchTransactions = useEvent((chainId?: UniverseChainId | undefined) => {
    return Boolean(
      isBatchedSwapsFlagEnabled && isOneClickSwapSettingEnabled && chainId && isAtomicBatchingSupportedByChain(chainId),
    )
  })

  const hasAlternateGasFeesByChain = useHasAlternateGasFeesByChainIdCallback()
  // oxlint-disable-next-line typescript/no-duplicate-type-constituents no-shadow -- biome-parity: oxlint is stricter here
  const getHasAlternateGasFees = useEvent((chainId?: UniverseChainId | undefined) => {
    return Boolean(chainId && hasAlternateGasFeesByChain(chainId))
  })

  const setActiveChainId = useSetActiveChainId()

  const onSwapChainsChanged = useEvent(
    ({
      chainId,
      prevChainId,
      outputChainId,
    }: {
      chainId: UniverseChainId
      outputChainId?: UniverseChainId
      prevChainId?: UniverseChainId
    }) => {
      setActiveChainId(chainId)
      showSwitchNetworkNotification({ chainId, outputChainId, prevChainId, action: SwitchNetworkAction.Swap })
    },
  )

  const accountDrawerMenu = useMenuState()

  const { isConnected } = useConnectionStatus()
  const onConnectWallet = useEvent((platform?: Platform) => {
    accountDrawer.open()

    // If a wallet is already connected, and swap prompts to connect on a specific platform,
    // then the connect platform menu should be shown
    if (platform && isConnected) {
      accountDrawerMenu.setMenuState({ variant: MenuStateVariant.CONNECT_PLATFORM, platform })
      return
    }
  })

  const navigateToAdvancedSettings = useCallback(() => {
    accountDrawer.open()
    accountDrawerMenu.setMenuState({ variant: MenuStateVariant.SETTINGS })
  }, [accountDrawer, accountDrawerMenu])

  const navigateToNftDetails = useNavigateToNftExplorerLink()

  useAccountChainIdEffect()

  return (
    <UniswapProvider
      signer={signer}
      useProviderHook={useWebProvider}
      useWalletDisplayName={useOnchainDisplayName}
      onSwapChainsChanged={onSwapChainsChanged}
      navigateToFiatOnRamp={navigateToFiatOnRamp}
      navigateToSwapFlow={navigateToSwapFlow}
      navigateToSendFlow={navigateToSendFlow}
      navigateToReceive={navigateToReceive}
      navigateToBuyOrReceiveWithEmptyWallet={navigateToBuyOrReceiveWithEmptyWallet}
      navigateToTokenDetails={navigateToTokenDetails}
      navigateToExternalProfile={navigateToExternalProfile}
      navigateToNftDetails={navigateToNftDetails}
      navigateToPoolDetails={navigateToPoolDetails}
      handleShareToken={handleShareToken}
      navigateToAdvancedSettings={navigateToAdvancedSettings}
      onConnectWallet={onConnectWallet}
      getCanSignPermits={getCanSignPermits}
      getIsUniswapXSupported={getIsUniswapXSupported}
      handleOnPressUniswapXUnsupported={handleOpenUniswapXUnsupportedModal}
      getCanBatchTransactions={getCanBatchTransactions}
      getHasAlternateGasFees={getHasAlternateGasFees}
      useAccountsStoreContextHook={useAccountsStoreContext}
    >
      {children}
    </UniswapProvider>
  )
}

const MismatchContextWrapper = React.memo(function MismatchContextWrapper({ children }: PropsWithChildren) {
  const getHasMismatch = useHasMismatchCallback()
  const account = useAccount()
  const onHasAnyMismatch = useShowMismatchToast()
  const { chains, defaultChainId, isTestnetModeEnabled } = useEnabledChains()
  return (
    <MismatchContextProvider
      mismatchCallback={getHasMismatch}
      address={account.address}
      chainId={account.chainId}
      onHasAnyMismatch={onHasAnyMismatch}
      chains={chains}
      defaultChainId={defaultChainId}
      isTestnetModeEnabled={isTestnetModeEnabled}
    >
      {children}
    </MismatchContextProvider>
  )
})

MismatchContextWrapper.displayName = 'MismatchContextWrapper'

/**
 * Sets the active chain id when the account chain id changes
 */
function useAccountChainIdEffect() {
  const currentChainId = useSelector((state: { delegation: DelegatedState }) => state.delegation.activeChainId)
  const { chainId } = useAccount()
  const { defaultChainId } = useEnabledChains()
  const accountChainId = chainId ?? defaultChainId
  const prevChainId = usePrevious(chainId)
  const setActiveChainId = useSetActiveChainId()

  useEffect(() => {
    if (!currentChainId) {
      setActiveChainId(accountChainId)
    } else if (prevChainId !== accountChainId) {
      setActiveChainId(accountChainId)
    }
  }, [accountChainId, currentChainId, prevChainId, setActiveChainId])
}
