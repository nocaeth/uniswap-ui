import { GqlResult } from '@universe/api'
import { useMemo } from 'react'
import { TokenOption } from 'uniswap/src/components/lists/items/types'
import { useCommonTokensOptions } from 'uniswap/src/components/TokenSelector/hooks/useCommonTokensOptions'
import { currencyInfosToTokenOptions } from 'uniswap/src/components/TokenSelector/hooks/useCurrencyInfosToTokenOptions'
import { type PortfolioBalancesResult } from 'uniswap/src/components/TokenSelector/hooks/usePortfolioBalancesForAddressById'
import { COMMON_BASES } from 'uniswap/src/constants/routing'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

export function useCommonTokensOptionsWithFallback({
  chainFilter,
  portfolioData,
}: {
  chainFilter: UniverseChainId | null
  portfolioData: PortfolioBalancesResult
}): GqlResult<TokenOption[] | undefined> {
  const { data, error, refetch, loading } = useCommonTokensOptions({ chainFilter, portfolioData })

  // Locally-defined common bases (full metadata, no backend resolution required).
  const commonBases = useMemo(
    () => (chainFilter ? currencyInfosToTokenOptions(COMMON_BASES[chainFilter]) : undefined),
    [chainFilter],
  )

  // GNOSIS-ONLY / non-backend chains: Uniswap's token backend does not serve Gnosis, so the
  // GQL-backed query errors (or returns empty). In that case fall back to the locally-defined
  // COMMON_BASES list so the token selector still renders the chain's tokens.
  const shouldFallback = (Boolean(error) || data?.length === 0) && Boolean(commonBases?.length)

  return useMemo(
    () => ({
      data: shouldFallback ? commonBases : data,
      error: shouldFallback ? undefined : error,
      refetch,
      loading,
    }),
    [commonBases, data, error, loading, refetch, shouldFallback],
  )
}
