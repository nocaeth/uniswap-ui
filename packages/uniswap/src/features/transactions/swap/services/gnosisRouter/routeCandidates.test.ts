import { FeeAmount } from '@uniswap/v3-sdk'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_EURE_V1,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_SDAI,
  GNOSIS_USDCE,
  GNOSIS_WETH,
  GNOSIS_WSTETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  buildGnosisRouteCandidatesFromPoolEdges,
  filterGnosisPoolGraphEdgesByTvl,
  hasGnosisPoolTvlMetadata,
  normalizeGnosisRouteTokenAddress,
  type CandidateRoute,
  type GnosisPoolGraphEdge,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'

const TOKEN_A = '0x1000000000000000000000000000000000000001'
const TOKEN_B = '0x2000000000000000000000000000000000000002'
const LOW_SORT_CUSTOM_HUB = '0x00000000000000000000000000000000000000aa'

function lower(address: string): string {
  return normalizeGnosisRouteTokenAddress(address)
}

function poolEdge(
  tokenA: string,
  tokenB: string,
  overrides: {
    fee?: FeeAmount
    liquidity?: string | number
    initialized?: boolean
    tvlUSD?: number
  } = {},
): GnosisPoolGraphEdge {
  return {
    tokenA,
    tokenB,
    fee: overrides.fee ?? FeeAmount.LOW,
    liquidity: overrides.liquidity ?? '100',
    initialized: overrides.initialized ?? true,
    tvlUSD: overrides.tvlUSD,
  }
}

function buildRoutes(args: {
  tokenIn?: string
  tokenOut?: string
  poolEdges: readonly GnosisPoolGraphEdge[]
  maxRoutes?: number
  routingHubs?: readonly string[]
}): CandidateRoute[] {
  return buildGnosisRouteCandidatesFromPoolEdges({
    tokenIn: args.tokenIn ?? TOKEN_A,
    tokenOut: args.tokenOut ?? TOKEN_B,
    poolEdges: args.poolEdges,
    maxRoutes: args.maxRoutes,
    routingHubs: args.routingHubs,
  })
}

describe('Gnosis route candidates', () => {
  it('includes the main Gnosis routing hub constants', () => {
    const routingHubs = GNOSIS_BASE_TOKENS.map(lower)

    expect(routingHubs).toEqual(
      expect.arrayContaining([
        lower(GNOSIS_USDCE),
        lower(GNOSIS_WXDAI),
        lower(GNOSIS_SDAI),
        lower(GNOSIS_EURE_V2),
        lower(GNOSIS_WSTETH),
      ]),
    )
  })

  it('does not use EURe v1 as a routing hub', () => {
    expect(GNOSIS_BASE_TOKENS.map(lower)).not.toContain(lower(GNOSIS_EURE_V1))
  })

  it('generates direct routes from viable pool edges', () => {
    const routes = buildRoutes({
      poolEdges: [poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM })],
    })

    expect(routes).toEqual([{ tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.MEDIUM] }])
  })

  it('uses legacy shared-state pools when the user selects canonical GBPe', () => {
    const routes = buildRoutes({
      tokenOut: GNOSIS_GBPE_V2,
      poolEdges: [poolEdge(TOKEN_A, GNOSIS_GBPE_V1, { fee: FeeAmount.LOW })],
    })

    expect(routes).toEqual([{ tokens: [TOKEN_A, GNOSIS_GBPE_V1], fees: [FeeAmount.LOW] }])
  })

  it('uses legacy shared-state pools when canonical GBPe is the input token', () => {
    const routes = buildRoutes({
      tokenIn: GNOSIS_GBPE_V2,
      poolEdges: [poolEdge(GNOSIS_GBPE_V1, TOKEN_B, { fee: FeeAmount.LOW })],
    })

    expect(routes).toEqual([{ tokens: [GNOSIS_GBPE_V1, TOKEN_B], fees: [FeeAmount.LOW] }])
  })

  it('generates 2-hop routes through routing hubs', () => {
    const routes = buildRoutes({
      poolEdges: [
        poolEdge(TOKEN_A, GNOSIS_USDCE, { fee: FeeAmount.LOW }),
        poolEdge(GNOSIS_USDCE, TOKEN_B, { fee: FeeAmount.MEDIUM }),
      ],
    })

    expect(routes).toContainEqual({
      tokens: [TOKEN_A, GNOSIS_USDCE, TOKEN_B],
      fees: [FeeAmount.LOW, FeeAmount.MEDIUM],
    })
  })

  it('generates 3-hop routes through routing hubs', () => {
    const routes = buildRoutes({
      poolEdges: [
        poolEdge(TOKEN_A, GNOSIS_USDCE, { fee: FeeAmount.LOW }),
        poolEdge(GNOSIS_USDCE, GNOSIS_SDAI, { fee: FeeAmount.LOWEST }),
        poolEdge(GNOSIS_SDAI, TOKEN_B, { fee: FeeAmount.MEDIUM }),
      ],
    })

    expect(routes).toContainEqual({
      tokens: [TOKEN_A, GNOSIS_USDCE, GNOSIS_SDAI, TOKEN_B],
      fees: [FeeAmount.LOW, FeeAmount.LOWEST, FeeAmount.MEDIUM],
    })
  })

  it('drops missing, zero-liquidity, and uninitialized edges', () => {
    const routes = buildRoutes({
      poolEdges: [
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, liquidity: '0' }),
        poolEdge(TOKEN_A, GNOSIS_USDCE, {
          fee: FeeAmount.LOW,
          initialized: false,
        }),
        poolEdge(GNOSIS_USDCE, TOKEN_B, { fee: FeeAmount.LOW }),
        poolEdge(TOKEN_A, GNOSIS_SDAI, { fee: FeeAmount.MEDIUM }),
      ],
    })

    expect(routes).toEqual([])
  })

  it('filters dust pool edges by TVL for the preferred route pass', () => {
    const poolEdges = [
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: 999 }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: 1_000 }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.HIGH }),
      poolEdge(TOKEN_A, GNOSIS_USDCE),
    ]

    expect(hasGnosisPoolTvlMetadata(poolEdges)).toBe(true)
    const routes = buildRoutes({ poolEdges: filterGnosisPoolGraphEdgesByTvl(poolEdges, 1_000) })

    expect(routes).toEqual(
      expect.arrayContaining([
        { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.MEDIUM] },
        { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.HIGH] },
      ]),
    )
    expect(routes).not.toContainEqual({ tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.LOW] })
  })

  it('ranks capped same-hop routes by TVL before raw v3 liquidity when TVL is known', () => {
    const routes = buildRoutes({
      maxRoutes: 1,
      poolEdges: [
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, liquidity: '1000000000000', tvlUSD: 1_000 }),
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, liquidity: '1', tvlUSD: 10_000 }),
      ],
    })

    expect(routes).toEqual([{ tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.MEDIUM] }])
  })

  it('does not generate repeated-token loops', () => {
    const routes = buildRoutes({
      poolEdges: [
        poolEdge(TOKEN_A, GNOSIS_USDCE),
        poolEdge(GNOSIS_USDCE, GNOSIS_SDAI),
        poolEdge(GNOSIS_SDAI, TOKEN_A),
        poolEdge(GNOSIS_SDAI, TOKEN_B),
      ],
    })

    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(new Set(route.tokens.map(lower)).size).toBe(route.tokens.length)
    }
  })

  it('applies the cap after pruning and ranking viable routes', () => {
    const routes = buildRoutes({
      maxRoutes: 1,
      poolEdges: [
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOWEST, liquidity: '0' }),
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, liquidity: '10' }),
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, liquidity: '500' }),
        poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.HIGH, liquidity: '100' }),
      ],
    })

    expect(routes).toEqual([{ tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.MEDIUM] }])
  })

  it('prefers USDC.e for stable-to-stable routes when liquidity and hops tie', () => {
    const routes = buildRoutes({
      tokenIn: GNOSIS_WXDAI,
      tokenOut: GNOSIS_EURE_V2,
      maxRoutes: 1,
      routingHubs: [LOW_SORT_CUSTOM_HUB, GNOSIS_USDCE],
      poolEdges: [
        poolEdge(GNOSIS_WXDAI, LOW_SORT_CUSTOM_HUB),
        poolEdge(LOW_SORT_CUSTOM_HUB, GNOSIS_EURE_V2),
        poolEdge(GNOSIS_WXDAI, GNOSIS_USDCE),
        poolEdge(GNOSIS_USDCE, GNOSIS_EURE_V2),
      ],
    })

    expect(routes).toEqual([
      {
        tokens: [GNOSIS_WXDAI, GNOSIS_USDCE, GNOSIS_EURE_V2],
        fees: [FeeAmount.LOW, FeeAmount.LOW],
      },
    ])
  })

  it('uses legacy shared-state pools for canonical EURe routing hubs', () => {
    const routes = buildRoutes({
      routingHubs: [GNOSIS_EURE_V2],
      poolEdges: [poolEdge(TOKEN_A, GNOSIS_EURE_V1), poolEdge(GNOSIS_EURE_V1, TOKEN_B)],
    })

    expect(routes).toEqual([{ tokens: [TOKEN_A, GNOSIS_EURE_V1, TOKEN_B], fees: [FeeAmount.LOW, FeeAmount.LOW] }])
  })

  it('prefers wstETH for ETH-correlated routes when liquidity and hops tie', () => {
    const routes = buildRoutes({
      tokenIn: GNOSIS_WETH,
      tokenOut: TOKEN_B,
      maxRoutes: 1,
      routingHubs: [LOW_SORT_CUSTOM_HUB, GNOSIS_WSTETH],
      poolEdges: [
        poolEdge(GNOSIS_WETH, LOW_SORT_CUSTOM_HUB),
        poolEdge(LOW_SORT_CUSTOM_HUB, TOKEN_B),
        poolEdge(GNOSIS_WETH, GNOSIS_WSTETH),
        poolEdge(GNOSIS_WSTETH, TOKEN_B),
      ],
    })

    expect(routes).toEqual([
      {
        tokens: [GNOSIS_WETH, GNOSIS_WSTETH, TOKEN_B],
        fees: [FeeAmount.LOW, FeeAmount.LOW],
      },
    ])
  })
})
