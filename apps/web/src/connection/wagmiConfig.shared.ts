import type { getChainInfo } from 'uniswap/src/features/chains/chainInfo'

// Only accept Safe Apps SDK messages from the canonical Safe web app.
// Tested against bypass patterns in wagmiConfig.test.ts.
export const SAFE_ALLOWED_ORIGIN = /^https:\/\/app\.safe\.global$/

export const orderedTransportUrls = (chain: ReturnType<typeof getChainInfo>): string[] => {
  const orderedRpcUrls = [
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    ...(chain.rpcUrls.interface?.http ?? []),
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    ...(chain.rpcUrls.default?.http ?? []),
    ...(chain.rpcUrls.public?.http ?? []),
    ...(chain.rpcUrls.fallback?.http ?? []),
  ]

  return Array.from(new Set(orderedRpcUrls.filter(Boolean)))
}
