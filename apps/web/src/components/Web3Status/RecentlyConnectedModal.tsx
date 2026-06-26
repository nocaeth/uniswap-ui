import { DisplayNameType } from 'uniswap/src/features/accounts/types'
import { useOnchainDisplayName } from 'uniswap/src/features/accounts/useOnchainDisplayName'
import { shortenAddress } from 'utilities/src/addresses'

export function useWalletDisplay(walletAddress: string | undefined) {
  const displayName = useOnchainDisplayName(walletAddress, {
    showShortenedEns: true,
  })

  return {
    displayName: displayName?.name ?? shortenAddress({ address: walletAddress }),
    showShortAddress: displayName?.type === DisplayNameType.ENS,
    shortAddress: shortenAddress({ address: walletAddress }),
  }
}
