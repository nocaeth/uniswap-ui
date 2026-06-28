// oxlint-disable eslint-js/no-restricted-syntax -- Vite statically replaces this Gnosis deployment env var at build time.
import { QUOTER_ADDRESSES, V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_EURE_CANONICAL_ADDRESS,
  GNOSIS_EURE_LEGACY_ADDRESS,
  GNOSIS_GBPE_CANONICAL_ADDRESS,
  GNOSIS_GBPE_LEGACY_ADDRESSES,
} from 'uniswap/src/features/tokens/gnosisCanonicalTokens'

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
export const GNOSIS_WSTETH = '0x6c76971f98945ae98dd7d4dfca8711ebea946ea6'
export const GNOSIS_SDAI = '0xaf204776c7245bf4147c2612bf6e5972ee483701'
export const GNOSIS_SDAI_ADAPTER_ADDRESS = '0xD499b51fcFc66bd31248ef4b28d656d67E591A94'
export const GNOSIS_EURE_V2 = GNOSIS_EURE_CANONICAL_ADDRESS
// EURe v1 is intentionally not a routing hub.
export const GNOSIS_EURE_V1 = GNOSIS_EURE_LEGACY_ADDRESS
export const GNOSIS_GBPE_V2 = GNOSIS_GBPE_CANONICAL_ADDRESS
// GBPe v1 is intentionally not a routing hub.
export const GNOSIS_GBPE_V1 = GNOSIS_GBPE_LEGACY_ADDRESSES[0]

// Intermediate tokens tried when there is no good direct pool. Keep this bounded:
// pool-aware route generation prunes missing/empty pools before quote calls.
export const GNOSIS_BASE_TOKENS: string[] = [GNOSIS_USDCE, GNOSIS_WXDAI, GNOSIS_SDAI, GNOSIS_EURE_V2, GNOSIS_WSTETH]

export const GNOSIS_STABLE_ROUTE_TOKENS: string[] = [
  GNOSIS_WXDAI,
  GNOSIS_USDCE,
  GNOSIS_SDAI,
  GNOSIS_EURE_V2,
  GNOSIS_USDT,
]
export const GNOSIS_PREFERRED_STABLE_ROUTE_HUBS: string[] = [GNOSIS_USDCE, GNOSIS_SDAI, GNOSIS_EURE_V2]

export const GNOSIS_ETH_CORRELATED_ROUTE_TOKENS: string[] = [GNOSIS_WETH, GNOSIS_WSTETH]
export const GNOSIS_PREFERRED_ETH_ROUTE_HUBS: string[] = [GNOSIS_WSTETH]

// Counterparties for which a WXDAI/xDAI swap routes better through the sDAI zap (SdaiZapRouter):
// WXDAI's only direct v3 edge is the shallow WXDAI/USDC.e pool, while these tokens sit on the deep
// sDAI-centered cluster (sDAI/EURe, sDAI/wstETH, EURe/USDC.e). Bridging WXDAI<->sDAI is free via the
// savings adapter, so WXDAI<->{these} is quoted as adapter + a single deep v3 path. Curated to
// tokens we know route well from sDAI; extend as deeper pools appear. See ./sdaiZap.ts.
export const GNOSIS_SDAI_ZAP_COUNTERPARTIES: string[] = [GNOSIS_USDCE, GNOSIS_EURE_V2, GNOSIS_WSTETH, GNOSIS_WETH]

export const GNOSIS_FEE_TIERS: FeeAmount[] = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH]

// Upper bound on candidate routes quoted per request. With Multicall3 every route is
// quoted in a single eth_call, but we still cap to bound calldata size and decode work.
export const GNOSIS_MAX_CANDIDATE_ROUTES = 96

// Firm quotes try these hop limits in order, stopping at the first whose best route is viable
// (non-absurd price impact). The deep v3 graph is a near-linear chain
// (WETH–wstETH–sDAI–EURe–USDC.e–WXDAI), so cluster-crossing pairs need up to 5 hops; common pairs
// resolve at 3 and never pay for the longer passes. Indicative (keystroke) quotes use only the first.
export const GNOSIS_ROUTE_HOP_TIERS = [3, 4, 5] as const
// Hard clamp on hops in candidate generation; must cover the largest tier above.
export const GNOSIS_MAX_ROUTE_HOPS: number = Math.max(...GNOSIS_ROUTE_HOP_TIERS)
// Per token-pair, expand only the N deepest-liquidity pools (fee tiers) into candidate routes. Bounds
// the candidate count as the hop limit grows so deep long routes survive the GNOSIS_MAX_CANDIDATE_ROUTES cap.
export const GNOSIS_MAX_POOLS_PER_PAIR = 2

// Preferred routing pass ignores dust pools. If that produces no usable quote,
// swaps fall back to the full initialized-pool graph.
export const GNOSIS_MIN_CANDIDATE_POOL_TVL_USD = 1_000

// Multicall3 is deployed at the same canonical address on Gnosis as everywhere else.
export const GNOSIS_MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

// Time budgets (ms) before a quote attempt is aborted. Indicative (keystroke) quotes get a
// tighter budget so a slow RPC can't stall typing; full quotes get more room.
export const GNOSIS_QUOTE_TIMEOUT_MS = 8_000
export const GNOSIS_INDICATIVE_QUOTE_TIMEOUT_MS = 4_000

// A full quote whose execution price sits at least this far (%) below pool spot price has no viable
// route — its only path runs through a near-empty pool (e.g. 10 WETH -> 0.000133 WXDAI, ~100% impact
// when no liquid WETH->WXDAI path exists within the hop limit). Such quotes are rejected rather than
// surfaced. Set far above any legitimate trade's impact so it never rejects a real quote.
export const GNOSIS_MAX_VIABLE_PRICE_IMPACT_PCT = 90

/**
 * UniversalRouter address on Gnosis. UniversalRouter has no canonical address, so
 * this MUST be set to the address you deployed (see gnosis/contracts/README.md).
 * Until then it is the zero address and swap-tx building will fail loudly.
 */
export const GNOSIS_UNIVERSAL_ROUTER_ADDRESS: string =
  process.env['REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS'] ?? '0x0000000000000000000000000000000000000000'

export const GNOSIS_VELORA_BASE_URL: string =
  process.env['REACT_APP_GNOSIS_VELORA_BASE_URL'] ?? 'https://api.velora.xyz'
export const GNOSIS_VELORA_PARTNER: string = process.env['REACT_APP_GNOSIS_VELORA_PARTNER'] ?? 'noca'
export const GNOSIS_VELORA_DISABLED: boolean = process.env['REACT_APP_GNOSIS_VELORA_DISABLED'] === 'true'

// Permit2 is the canonical singleton (same address everywhere).
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/**
 * SdaiZapRouter address on Gnosis (see gnosis/contracts/sdai-zap). Like UniversalRouter it has no
 * canonical address; set REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS to your deployment to enable sDAI-zap
 * routing. While it is the zero address the zap is fully disabled: no zap quotes are produced and
 * no zap approvals are requested, so behavior is unchanged from the v3-only router.
 */
export const GNOSIS_SDAI_ZAP_ADDRESS: string =
  process.env['REACT_APP_GNOSIS_SDAI_ZAP_ADDRESS'] ?? '0x0000000000000000000000000000000000000000'

/**
 * Split-fill routing (see ./fetchGnosisQuote.ts and docs/split-fill-routing-spec.md).
 *
 * Splits a single EXACT_INPUT swap across pool-disjoint v3 routes, executed atomically in one
 * UniversalRouter transaction, to reduce price impact on size. The universal-router-sdk already
 * consumes a multi-sub-route quote natively, so this is a quote-production-only change. Always on:
 * the accept gate below means a split is only used when it actually beats the single best route.
 */
// Max routes a split fans across. At 2, the SDK enforces slippage per-leg (no aggregate sweep);
// raise only if 3 deep disjoint routes prove worthwhile.
export const GNOSIS_MAX_SPLIT_LEGS = 2
// Simplex grid resolution per split: G steps => G+1 allocations for a 2-leg split, all quoted in
// one Multicall3 call. Keep small to bound added quote latency.
export const GNOSIS_SPLIT_GRID_STEPS = 10
// Minimum output improvement (bps) over the single best route before a split is used. Gnosis gas
// is negligible, so this token-gain floor is the whole accept gate (no net-of-gas term).
export const GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS = 5
