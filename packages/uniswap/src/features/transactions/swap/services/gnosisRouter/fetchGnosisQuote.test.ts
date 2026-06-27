import { FeeAmount } from '@uniswap/v3-sdk'
import { buildCandidateRouteSets } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/fetchGnosisQuote'
import type { GnosisPoolGraphEdge } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'

const TOKEN_A = '0x1000000000000000000000000000000000000001'
const TOKEN_B = '0x2000000000000000000000000000000000000002'

// Mirrors GNOSIS_MIN_CANDIDATE_POOL_TVL_USD (1_000) so edges straddle the real floor.
const ABOVE_FLOOR = 5_000
const BELOW_FLOOR = 100

function poolEdge(
  tokenA: string,
  tokenB: string,
  overrides: { fee?: FeeAmount; tvlUSD?: number } = {},
): GnosisPoolGraphEdge {
  return {
    tokenA,
    tokenB,
    fee: overrides.fee ?? FeeAmount.LOW,
    liquidity: '100',
    initialized: true,
    tvlUSD: overrides.tvlUSD,
  }
}

function buildSets(poolEdges: readonly GnosisPoolGraphEdge[]): ReturnType<typeof buildCandidateRouteSets> {
  return buildCandidateRouteSets({ tokenIn: TOKEN_A, tokenOut: TOKEN_B, poolEdges })
}

const DIRECT_LOW = { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.LOW] }
const DIRECT_MEDIUM = { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.MEDIUM] }
const DIRECT_HIGH = { tokens: [TOKEN_A, TOKEN_B], fees: [FeeAmount.HIGH] }

describe('buildCandidateRouteSets', () => {
  it('treats every route as preferred and offers no fallback when no pool has TVL metadata', () => {
    const { preferredRoutes, getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM }),
    ])

    expect(preferredRoutes).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
    expect(getFallbackRoutes()).toEqual([])
  })

  it('drops confirmed sub-threshold pools from preferred but keeps them in fallback', () => {
    const { preferredRoutes, getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: BELOW_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: ABOVE_FLOOR }),
    ])

    expect(preferredRoutes).toContainEqual(DIRECT_MEDIUM)
    expect(preferredRoutes).not.toContainEqual(DIRECT_LOW)

    const fallback = getFallbackRoutes()
    expect(fallback).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
  })

  it('keeps pools with unknown TVL in the preferred set when other pools have TVL', () => {
    const { preferredRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: ABOVE_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM }), // unknown TVL — must be kept
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.HIGH, tvlUSD: BELOW_FLOOR }), // dust — dropped
    ])

    expect(preferredRoutes).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
    expect(preferredRoutes).not.toContainEqual(DIRECT_HIGH)
  })

  it('returns no fallback when the TVL filter removes nothing (preferred === fallback)', () => {
    const { preferredRoutes, getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: ABOVE_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: ABOVE_FLOOR }),
    ])

    expect(preferredRoutes).toEqual(expect.arrayContaining([DIRECT_LOW, DIRECT_MEDIUM]))
    expect(getFallbackRoutes()).toEqual([])
  })

  it('builds the fallback set at most once (memoized)', () => {
    const { getFallbackRoutes } = buildSets([
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.LOW, tvlUSD: BELOW_FLOOR }),
      poolEdge(TOKEN_A, TOKEN_B, { fee: FeeAmount.MEDIUM, tvlUSD: ABOVE_FLOOR }),
    ])

    // A non-empty fallback returns the same memoized array reference across calls.
    expect(getFallbackRoutes()).toBe(getFallbackRoutes())
  })
})
