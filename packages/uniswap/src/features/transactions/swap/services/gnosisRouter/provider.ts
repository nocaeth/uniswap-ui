import { JsonRpcProvider } from '@ethersproject/providers'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'

let cachedProvider: JsonRpcProvider | undefined

/**
 * Ethers provider for Gnosis used by the client-side router. Built from the Gnosis
 * chain-info RPC URLs (Interface, falling back to Default) rather than the app's
 * apps/web provider, so this module stays inside packages/uniswap.
 */
export function getGnosisProvider(): JsonRpcProvider {
  if (cachedProvider) {
    return cachedProvider
  }
  const info = getChainInfo(UniverseChainId.Gnosis)
  const url = info.rpcUrls[RPCType.Interface].http[0] ?? info.rpcUrls[RPCType.Default].http[0]
  cachedProvider = new JsonRpcProvider(url, { chainId: UniverseChainId.Gnosis, name: info.interfaceName })
  return cachedProvider
}
