import { useActiveAddresses } from 'uniswap/src/features/accounts/store/hooks'
import { shortenAddress } from 'utilities/src/addresses'
import { useEnsName } from 'wagmi'

// Returns an identifier for the current or recently connected account, prioritizing ENS name -> address
export function useAccountIdentifier() {
  const { evmAddress, svmAddress } = useActiveAddresses()

  const { data: ensName } = useEnsName({ address: evmAddress })

  const accountIdentifier = ensName ?? shortenAddress({ address: evmAddress ?? svmAddress })

  return {
    accountIdentifier,
  }
}
