import { useMemo } from 'react'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { usePortfolioTotalValue } from 'uniswap/src/features/dataApi/balances/balancesRest'
import { useActiveAddresses } from '~/features/accounts/store/hooks'

/**
 * Hook to determine if the connected wallet's portfolio balance is zero.
 * Denominated portfolio balance on testnet is always 0, so we don't consider it zero in testnet mode.
 */
export function useIsPortfolioZero(): boolean {
  const { evmAddress, svmAddress } = useActiveAddresses()
  const { isTestnetModeEnabled } = useEnabledChains()

  const { data: portfolioData } = usePortfolioTotalValue({
    evmAddress,
    svmAddress,
  })

  const { balanceUSD } = portfolioData || {}

  // Denominated portfolio balance on testnet is always 0
  return useMemo(() => !isTestnetModeEnabled && balanceUSD === 0, [isTestnetModeEnabled, balanceUSD])
}
