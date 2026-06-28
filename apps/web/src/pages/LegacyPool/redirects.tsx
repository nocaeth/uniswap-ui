import { Navigate, useParams, useSearchParams } from 'react-router'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { toGraphQLChain } from 'uniswap/src/features/chains/utils'
import { useAccount } from '~/hooks/useAccount'
import { searchParamToBackendName } from '~/utils/params/chainParams'

// /pool
export function LegacyPoolRedirects() {
  return <Navigate to="/positions" replace />
}

// /pool/:tokenId?chain=...
export function LegacyPositionPageRedirects() {
  const { tokenId } = useParams<{ tokenId: string }>()
  const [searchParams] = useSearchParams()
  const { chainId: connectedChainId } = useAccount()
  const { defaultChainId } = useEnabledChains()

  if (tokenId === 'v2') {
    return <Navigate to="/not-found" replace />
  }

  const chainName =
    searchParamToBackendName(searchParams.get('chain'))?.toLowerCase() ??
    toGraphQLChain(connectedChainId ?? defaultChainId).toLowerCase()
  return <Navigate to={`/positions/v3/${chainName}/${tokenId}`} replace />
}
