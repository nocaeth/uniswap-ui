import { Navigate, useParams, useSearchParams } from 'react-router'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { useAccount } from '~/hooks/useAccount'
import { getChainUrlParam, searchParamToBackendName } from '~/utils/params/chainParams'

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
    getChainUrlParam(connectedChainId ?? defaultChainId)
  return <Navigate to={`/positions/v3/${chainName}/${tokenId}`} replace />
}
