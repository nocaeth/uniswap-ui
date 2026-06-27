import { QUOTER_ADDRESSES, V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

/**
 * Gnosis client-side V3 routing config.
 *
 * Uniswap's Trading API does not serve Gnosis (100), so swaps are quoted on-chain
 * via QuoterV2 and executed through our UniversalRouter. See ./fetchGnosisQuote.ts.
 */

// QuoterV2 + V3 factory come from the patched @uniswap/sdk-core address maps
// (guaranteed present for Gnosis by patches/@uniswap%2Fsdk-core@7.17.0.patch).
export const GNOSIS_QUOTER_ADDRESS = QUOTER_ADDRESSES[UniverseChainId.Gnosis] as string
export const GNOSIS_V3_FACTORY_ADDRESS = V3_CORE_FACTORY_ADDRESSES[UniverseChainId.Gnosis] as string

// Routing hubs used to build multi-hop candidate paths (lowercased addresses).
export const GNOSIS_WXDAI = '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'
export const GNOSIS_USDCE = '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0'
export const GNOSIS_USDT = '0x4eCAbA5870353805a9f068101A8e0e64dD33cD47'
export const GNOSIS_WETH = '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1'

// Intermediate tokens tried when there is no good direct pool. WXDAI/USDC.e are the
// deepest hubs on Gnosis; keep this list small to bound the number of quote calls.
export const GNOSIS_BASE_TOKENS: string[] = [GNOSIS_WXDAI, GNOSIS_USDCE]

export const GNOSIS_FEE_TIERS: FeeAmount[] = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH]

// Upper bound on candidate routes quoted per request. With Multicall3 every route is
// quoted in a single eth_call, but we still cap to bound calldata size and decode work.
export const GNOSIS_MAX_CANDIDATE_ROUTES = 40

// Multicall3 is deployed at the same canonical address on Gnosis as everywhere else.
export const GNOSIS_MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

// Time budgets (ms) before a quote attempt is aborted. Indicative (keystroke) quotes get a
// tighter budget so a slow RPC can't stall typing; full quotes get more room.
export const GNOSIS_QUOTE_TIMEOUT_MS = 8_000
export const GNOSIS_INDICATIVE_QUOTE_TIMEOUT_MS = 4_000

/**
 * UniversalRouter address on Gnosis. UniversalRouter has no canonical address, so
 * this MUST be set to the address you deployed (see gnosis/contracts/README.md).
 * Until then it is the zero address and swap-tx building will fail loudly.
 */
export const GNOSIS_UNIVERSAL_ROUTER_ADDRESS: string =
  process.env['REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS'] ?? '0x0000000000000000000000000000000000000000'

// Permit2 is the canonical singleton (same address everywhere).
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
