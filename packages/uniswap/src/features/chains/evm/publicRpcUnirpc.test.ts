import { ORDERED_EVM_CHAINS } from 'uniswap/src/features/chains/chainInfo'
import { RPCType } from 'uniswap/src/features/chains/types'

/**
 * `rpcUrls[RPCType.Public]` is the primary public endpoint for each chain — the
 * URL the resolver's legacy/fallback branch returns and that direct chain-info
 * readers use. Public endpoints should not slip back to QuickNode directly; most
 * chains use UniRPC, while Gnosis intentionally uses direct public Gnosis RPC.
 *
 * UniRPC does not route Solana yet (SVM, not in ORDERED_EVM_CHAINS), so it stays
 * on QuickNode and is intentionally out of scope here.
 */
describe('RPCType.Public avoids direct QuickNode URLs', () => {
  it.each(ORDERED_EVM_CHAINS.map((chain) => [chain.name, chain] as const))(
    '%s Public rpc urls avoid direct QuickNode endpoints',
    (_name, chain) => {
      const publicUrls = chain.rpcUrls[RPCType.Public].http
      for (const url of publicUrls) {
        expect(url).not.toMatch(/quiknode\.pro/i)
      }
    },
  )
})
