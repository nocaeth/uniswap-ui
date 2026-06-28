import { GqlResult, GraphQLApi } from '@universe/api'
import { useMemo } from 'react'
import { getCommonBase } from 'uniswap/src/constants/routing'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { currencyIdToContractInput } from 'uniswap/src/features/dataApi/utils/currencyIdToContractInput'
import { gqlTokenToCurrencyInfo } from 'uniswap/src/features/dataApi/utils/gqlTokenToCurrencyInfo'
import { getGnosisTokenListLogoURI } from 'uniswap/src/features/tokens/gnosisTokenList'
import {
  buildNativeCurrencyId,
  buildWrappedNativeCurrencyId,
  currencyIdToAddress,
  currencyIdToChain,
} from 'uniswap/src/utils/currencyId'

type GqlToken = NonNullable<ReturnType<typeof GraphQLApi.useTokenQuery>['data']>['token']

function getCurrencyInfoWithLocalFallback(currencyId?: string, gqlToken?: GqlToken): Maybe<CurrencyInfo> {
  if (!currencyId) {
    return undefined
  }

  const chainId = currencyIdToChain(currencyId)
  let address: Address | undefined
  try {
    address = currencyIdToAddress(currencyId)
  } catch (_error) {
    return undefined
  }

  if (chainId && address) {
    const commonBase = getCommonBase(chainId, address)
    if (commonBase) {
      // Creating new object to avoid error "Cannot assign to read only property"
      const copyCommonBase = { ...commonBase }
      const gnosisTokenListLogoUrl = getGnosisTokenListLogoURI({ address, chainId })
      // Related to TODO(WEB-5111): prefer the local Gnosis token-list asset when
      // present, otherwise fall back to remote project metadata for common bases.
      if (gnosisTokenListLogoUrl) {
        copyCommonBase.logoUrl = gnosisTokenListLogoUrl
      } else if (gqlToken?.project?.logoUrl) {
        copyCommonBase.logoUrl = gqlToken.project.logoUrl
      }
      copyCommonBase.currencyId = currencyId

      // Local common base object will not have remote project id, so we add it here.
      copyCommonBase.projectId = gqlToken?.project?.id

      return copyCommonBase
    }
  }

  return gqlToken ? gqlTokenToCurrencyInfo(gqlToken) : undefined
}

function useCurrencyInfoQuery(
  _currencyId?: string,
  options?: { refetch?: boolean; skip?: boolean },
): { currencyInfo: Maybe<CurrencyInfo>; loading: boolean; error?: Error } {
  const queryResult = GraphQLApi.useTokenQuery({
    variables: currencyIdToContractInput(_currencyId ?? ''),
    skip: !_currencyId || options?.skip,
    fetchPolicy: options?.refetch ? 'cache-and-network' : 'cache-first',
  })

  const currencyInfo = useMemo(
    () => getCurrencyInfoWithLocalFallback(_currencyId, queryResult.data?.token),
    [_currencyId, queryResult.data?.token],
  )

  return {
    currencyInfo,
    loading: queryResult.loading,
    error: queryResult.error,
  }
}

export function useCurrencyInfo(
  _currencyId?: string,
  options?: { refetch?: boolean; skip?: boolean },
): Maybe<CurrencyInfo> {
  const { currencyInfo } = useCurrencyInfoQuery(_currencyId, options)
  return currencyInfo
}

export function useCurrencyInfoWithLoading(
  _currencyId?: string,
  options?: { refetch?: boolean; skip?: boolean },
): {
  currencyInfo: Maybe<CurrencyInfo>
  loading: boolean
  error?: Error
} {
  return useCurrencyInfoQuery(_currencyId, options)
}

export function useCurrencyInfos(
  _currencyIds: string[],
  options?: { refetch?: boolean; skip?: boolean },
): Maybe<CurrencyInfo>[] {
  const { data } = GraphQLApi.useTokensQuery({
    variables: {
      contracts: _currencyIds.map(currencyIdToContractInput),
    },
    skip: !_currencyIds.length || options?.skip,
    fetchPolicy: options?.refetch ? 'cache-and-network' : 'cache-first',
  })

  return useMemo(() => {
    return _currencyIds.map((currencyId, index) => getCurrencyInfoWithLocalFallback(currencyId, data?.tokens?.[index]))
  }, [_currencyIds, data?.tokens])
}

export function useCurrencyInfosWithLoading(
  _currencyIds: string[],
  options?: { refetch?: boolean; skip?: boolean },
): GqlResult<CurrencyInfo[]> {
  const queryResult = GraphQLApi.useTokensQuery({
    variables: {
      contracts: _currencyIds.map(currencyIdToContractInput),
    },
    skip: !_currencyIds.length || options?.skip,
    fetchPolicy: options?.refetch ? 'cache-and-network' : 'cache-first',
  })

  return useMemo(() => {
    return {
      data: _currencyIds
        .map((currencyId, index) => getCurrencyInfoWithLocalFallback(currencyId, queryResult.data?.tokens?.[index]))
        .filter((currencyInfo): currencyInfo is CurrencyInfo => Boolean(currencyInfo)),
      loading: queryResult.loading,
      error: queryResult.error,
      refetch: queryResult.refetch,
    }
  }, [_currencyIds, queryResult.data?.tokens, queryResult.loading, queryResult.error, queryResult.refetch])
}

export function useNativeCurrencyInfo(chainId: UniverseChainId): Maybe<CurrencyInfo> {
  const nativeCurrencyId = buildNativeCurrencyId(chainId)
  return useCurrencyInfo(nativeCurrencyId)
}

export function useWrappedNativeCurrencyInfo(chainId: UniverseChainId): Maybe<CurrencyInfo> {
  const wrappedCurrencyId = buildWrappedNativeCurrencyId(chainId)
  return useCurrencyInfo(wrappedCurrencyId)
}
