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

/**
 * UniversalRouter address on Gnosis. UniversalRouter has no canonical address, so
 * this MUST be set to the address you deployed (see gnosis/contracts/README.md).
 * Until then it is the zero address and swap-tx building will fail loudly.
 */
export const GNOSIS_UNIVERSAL_ROUTER_ADDRESS: string =
  process.env['REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS'] ?? '0x0000000000000000000000000000000000000000'

// Permit2 is the canonical singleton (same address everywhere).
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
