import { FeeAmount } from '@uniswap/v3-sdk'
import type { CandidateRoute } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import {
  arePoolDisjoint,
  pickDisjointSet,
  routePoolKeys,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeDisjoint'

// Concrete lowercased addresses; values are arbitrary but distinct.
const A = '0xaaaa000000000000000000000000000000000001'
const B = '0xbbbb000000000000000000000000000000000002'
const C = '0xcccc000000000000000000000000000000000003'
const X = '0xdddd000000000000000000000000000000000004'
const EURE_V1 = '0xcb444e90d8198415266c6a2724b7900fb12fc56e'
const EURE_V2 = '0x420ca0f9b9b604ce0fad5c4e0639af9ba3430c56'.toLowerCase()
const USDC = '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0'

function route(tokens: string[], fees: FeeAmount[]): CandidateRoute {
  return { tokens, fees }
}

describe('routeDisjoint', () => {
  it('routes sharing the same (tokenA,tokenB,fee) pool are not disjoint', () => {
    const a = route([A, B], [FeeAmount.LOW])
    const b = route([A, B], [FeeAmount.LOW])
    expect(arePoolDisjoint(a, b)).toBe(false)
  })

  it('reversed token order resolves to the same pool (not disjoint)', () => {
    const a = route([A, B], [FeeAmount.LOW])
    const b = route([B, A], [FeeAmount.LOW])
    expect(arePoolDisjoint(a, b)).toBe(false)
    // canonical key is order-independent
    expect([...routePoolKeys(a)]).toEqual([...routePoolKeys(b)])
  })

  it('same token pair but different fee tiers are different pools (disjoint)', () => {
    const a = route([A, B], [FeeAmount.LOW])
    const b = route([A, B], [FeeAmount.MEDIUM])
    expect(arePoolDisjoint(a, b)).toBe(true)
  })

  it('shared-state v1 vs v2 pools are genuinely different pools (disjoint)', () => {
    const a = route([EURE_V1, USDC], [FeeAmount.LOW])
    const b = route([EURE_V2, USDC], [FeeAmount.LOW])
    // they share the USDC *token* but not a *pool*
    expect(arePoolDisjoint(a, b)).toBe(true)
  })

  it('routes sharing a token but no pool are disjoint', () => {
    const a = route([A, B], [FeeAmount.LOW]) // pool (A,B,LOW)
    const b = route([A, C], [FeeAmount.LOW]) // pool (A,C,LOW)
    expect(arePoolDisjoint(a, b)).toBe(true)
  })

  it('multi-hop route sharing one of its pools is not disjoint', () => {
    const direct = route([A, B], [FeeAmount.LOW]) // pool (A,B,LOW)
    const viaX = route([X, A, B], [FeeAmount.MEDIUM, FeeAmount.LOW]) // pools (X,A,MED) + (A,B,LOW)
    expect(arePoolDisjoint(direct, viaX)).toBe(false)
  })

  describe('pickDisjointSet', () => {
    it('keeps best and greedily adds the first disjoint route, capped at maxLegs', () => {
      const best = route([A, B], [FeeAmount.LOW]) // pool (A,B,LOW)
      const sharesBest = route([X, A, B], [FeeAmount.MEDIUM, FeeAmount.LOW]) // shares (A,B,LOW)
      const disjoint = route([A, B], [FeeAmount.MEDIUM]) // pool (A,B,MED) — disjoint from best
      const alsoDisjoint = route([A, C], [FeeAmount.LOW]) // pool (A,C,LOW)

      const ranked = [best, sharesBest, disjoint, alsoDisjoint]
      const picked = pickDisjointSet(ranked, 2)
      expect(picked).toEqual([best, disjoint]) // sharesBest skipped; capped at 2
    })

    it('returns only the best route when nothing else is disjoint', () => {
      const best = route([A, B], [FeeAmount.LOW])
      const overlap = route([B, A], [FeeAmount.LOW]) // same pool
      expect(pickDisjointSet([best, overlap], 2)).toEqual([best])
    })

    it('returns [] for an empty ranked list', () => {
      expect(pickDisjointSet([], 2)).toEqual([])
    })

    it('respects maxLegs = 3', () => {
      const r0 = route([A, B], [FeeAmount.LOW])
      const r1 = route([A, B], [FeeAmount.MEDIUM])
      const r2 = route([A, B], [FeeAmount.HIGH])
      const r3 = route([A, B], [FeeAmount.LOWEST])
      expect(pickDisjointSet([r0, r1, r2, r3], 3)).toEqual([r0, r1, r2])
    })
  })
})
