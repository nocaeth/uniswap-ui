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
export const GNOSIS_USDT = '0x4ECaBa5870353805a9F068101A40E0f32ed605C6'
export const GNOSIS_WETH = '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1'
export const GNOSIS_WSTETH = '0x6c76971f98945ae98dd7d4dfca8711ebea946ea6'
export const GNOSIS_SDAI = '0xaf204776c7245bf4147c2612bf6e5972ee483701'
export const GNOSIS_GNO = '0x9c58bacc331c9aa871afd802db6379a98e80cedb'
export const GNOSIS_OSGNO = '0xf490c80aae5f2616d3e3bda2483e30c4cb21d1a0'
export const GNOSIS_SDAI_ADAPTER_ADDRESS = '0xD499b51fcFc66bd31248ef4b28d656d67E591A94'
export const GNOSIS_USDC = '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83'
export const GNOSIS_COW = '0x177127622c4A00F3d409B75571e12cB3c8973d3c'
export const GNOSIS_USDC_TRANSMUTER_ADDRESS = '0x0392A2F5Ac47388945D8c84212469F545fAE52B2'
export const GNOSIS_CURVE_XDAI_USDC_USDT_POOL = '0x7f90122BF0700F9E7e1F688fe926940E8839F353'
export const GNOSIS_CURVE_X3CRV_TOKEN = '0x1337BedC9D22ecbe766dF105c9623922A27963EC'
export const GNOSIS_CURVE_USDCE_SDAI_POOL = '0x4a053d86bcccdfb6f85c46b38c5873129212dc1f'
export const GNOSIS_CURVE_GNO_OSGNO_POOL = '0xb5814811dc4fc2ac127a1f8fb708460bf9fad619'
export const GNOSIS_CURVE_EURE_X3CRV_POOL = '0x056c6c5e684cec248635ed86033378cc444459b0'
export const GNOSIS_EURE_V2 = GNOSIS_EURE_CANONICAL_ADDRESS
// EURe v1 is intentionally not a routing hub.
export const GNOSIS_EURE_V1 = GNOSIS_EURE_LEGACY_ADDRESS
export const GNOSIS_GBPE_V2 = GNOSIS_GBPE_CANONICAL_ADDRESS
// GBPe v1 is intentionally not a routing hub.
export const GNOSIS_GBPE_V1 = GNOSIS_GBPE_LEGACY_ADDRESSES[0]

// Intermediate tokens tried when there is no good direct pool. Keep this bounded:
// pool-aware route generation prunes missing/empty pools before quote calls.
export const GNOSIS_BASE_TOKENS: string[] = [
  GNOSIS_USDCE,
  GNOSIS_WXDAI,
  GNOSIS_SDAI,
  GNOSIS_EURE_V2,
  GNOSIS_WSTETH,
  GNOSIS_GNO,
  GNOSIS_WETH,
]

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

// Known counterparties that usually route well through the sDAI zap (SdaiZapRouter). The quoter may
// probe other WXDAI/xDAI pairs through sDAI too, but it only selects the zap when it beats the market.
// Keep this list as the documented/de-risked set for tests, analytics, and future route gating.
export const GNOSIS_SDAI_ZAP_COUNTERPARTIES: string[] = [
  GNOSIS_USDCE,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_WSTETH,
  GNOSIS_WETH,
]

export const GNOSIS_FEE_TIERS: FeeAmount[] = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH]

// Upper bound on candidate routes quoted per request. With Multicall3 every route is
// quoted in a single eth_call, but we still cap to bound calldata size and decode work.
export const GNOSIS_MAX_CANDIDATE_ROUTES = 96

// Hop ceiling for candidate generation and quoting. Every candidate route up to this length is
// quoted in ONE Multicall3 eth_call, so firm and indicative quotes both run a single pass at the
// ceiling and pick the best actual output — no escalating hop tiers. The deep v3 graph is a
// near-linear chain (WETH–wstETH–sDAI–EURe–USDC.e–WXDAI), so cluster-crossing pairs need up to
// 5 hops; a shorter first pass would let a thin short route shadow a deep longer one.
export const GNOSIS_MAX_ROUTE_HOPS = 5
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
 * Purpose-built exact-input aggregation router for Gnosis. It can atomically split across typed
 * Uniswap V3 / Curve / USDC-transmuter steps and enforce one aggregate min-out. Defaults to the
 * production Gnosis deployment; override with REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS for tests
 * or replacement deployments.
 */
export const GNOSIS_AGGREGATION_ROUTER_ADDRESS: string =
  process.env['REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS'] || '0x5Dc8F465Eb018dA68d61fFdB9B4658C8f929CD13'

/**
 * Curve Router NG address used for quoting the curated Curve leg set. Defaults to Curve's Gnosis
 * deployment; override with REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS for tests or replacement routing.
 */
export const GNOSIS_CURVE_ROUTER_ADDRESS: string =
  process.env['REACT_APP_GNOSIS_CURVE_ROUTER_ADDRESS'] || '0x0DCDED3545D565bA3B19E683431381007245d983'

/**
 * Split-fill routing (see ./fetchGnosisQuote.ts).
 *
 * Splits a single EXACT_INPUT swap across pool-disjoint v3 routes, executed atomically in one
 * UniversalRouter transaction, to reduce price impact on size. The universal-router-sdk already
 * consumes a multi-sub-route quote natively, so this is a quote-production-only change. Enabled by
 * default on Gnosis because gas is negligible; set REACT_APP_GNOSIS_SPLIT_ENABLED=false to disable.
 */
export const GNOSIS_SPLIT_ENABLED = process.env['REACT_APP_GNOSIS_SPLIT_ENABLED'] !== 'false'
// Max routes a split fans across. Three legs lets Gnosis fan out across the deep stable/ETH/GNO
// clusters while still keeping calldata and quote search bounded.
export const GNOSIS_MAX_SPLIT_LEGS = 3
// Simplex grid resolution per split: G steps => G+1 allocations for a 2-leg split, all quoted in
// one Multicall3 call. Keep small to bound added quote latency.
export const GNOSIS_SPLIT_GRID_STEPS = 10
// Minimum output improvement (bps) over the single best route before a split is used. Gnosis gas
// is negligible, so this token-gain floor is the whole accept gate (no net-of-gas term).
export const GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS = 3
// Depth-based split probe: also run the split grid whenever the trade would consume at least this
// fraction of the thinnest pool's in-range depth on the best route. The cheap impact estimate
// fails open to 0 when metadata/pool state is missing, which would otherwise silently skip the
// grid for exactly the large trades that most need splitting; the depth ratio needs no token
// metadata (raw units cancel), so it backstops that blind spot. Probing costs one extra Multicall3
// round-trip. The accept gate (GNOSIS_MIN_SPLIT_IMPROVEMENT_BPS) still decides on real quotes.
export const GNOSIS_SPLIT_PROBE_DEPTH_FRACTION = 0.25
// Candidate routes whose thinnest pool holds less than this fraction of the trade size in-range
// cannot win on output; they are dropped before quoting so they don't waste candidate-cap slots
// and quoter calldata. Fail-open: routes with unknown depth are never pruned, and pruning never
// leaves fewer than a minimum survivor count (see pruneShallowCandidateRoutes).
export const GNOSIS_MIN_ROUTE_DEPTH_INPUT_FRACTION = 0.01
