import { BigNumber } from '@ethersproject/bignumber'
import {
  activeLegCount,
  enumerateAllocations,
  passesAcceptGate,
  selectBestSplit,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/splitAllocation'

const bn = (n: number | string): BigNumber => BigNumber.from(n)

// Constant-product AMM curve: input x into a pool with reserves (rIn, rOut) returns
// rOut * x / (rIn + x). Concave in x, so splitting across two pools beats a single one.
function ammOut(rIn: BigNumber, rOut: BigNumber, x: BigNumber): BigNumber {
  if (x.isZero()) {
    return bn(0)
  }
  return rOut.mul(x).div(rIn.add(x))
}

describe('splitAllocation', () => {
  describe('enumerateAllocations', () => {
    it('produces steps+1 allocations for 2 legs, each summing exactly to total', () => {
      const total = bn(1000)
      const allocations = enumerateAllocations({ total, legs: 2, steps: 10 })
      expect(allocations).toHaveLength(11)
      for (const a of allocations) {
        expect(a).toHaveLength(2)
        expect(a[0]!.add(a[1]!).eq(total)).toBe(true)
      }
      // endpoints are the degenerate single-route allocations
      expect(allocations.some((a) => a[0]!.isZero() && a[1]!.eq(total))).toBe(true)
      expect(allocations.some((a) => a[0]!.eq(total) && a[1]!.isZero())).toBe(true)
    })

    it('conserves input exactly and routes the remainder to the deepest leg', () => {
      // total=7, steps=2 -> compositions (0,2),(1,1),(2,0)
      const total = bn(7)
      const toLeg1 = enumerateAllocations({ total, legs: 2, steps: 2, deepestLegIndex: 1 })
      // (1,1): floor(7/2)=3 each -> sum 6, remainder 1 to leg1 -> [3,4]
      expect(toLeg1.map((a) => [a[0]!.toNumber(), a[1]!.toNumber()])).toEqual([
        [0, 7],
        [3, 4],
        [7, 0],
      ])
      const toLeg0 = enumerateAllocations({ total, legs: 2, steps: 2, deepestLegIndex: 0 })
      expect(toLeg0.map((a) => [a[0]!.toNumber(), a[1]!.toNumber()])).toEqual([
        [0, 7],
        [4, 3],
        [7, 0],
      ])
      // every allocation still sums to total
      for (const a of [...toLeg0, ...toLeg1]) {
        expect(a[0]!.add(a[1]!).eq(total)).toBe(true)
      }
    })

    it('supports 3-leg splits (simplex), each summing to total', () => {
      const total = bn(900)
      const allocations = enumerateAllocations({ total, legs: 3, steps: 3 })
      // compositions of 3 into 3 parts = C(3+3-1, 3-1) = 10
      expect(allocations).toHaveLength(10)
      for (const a of allocations) {
        expect(a[0]!.add(a[1]!).add(a[2]!).eq(total)).toBe(true)
      }
    })

    it('returns [] for degenerate inputs', () => {
      expect(enumerateAllocations({ total: bn(100), legs: 0, steps: 10 })).toEqual([])
      expect(enumerateAllocations({ total: bn(100), legs: 2, steps: 0 })).toEqual([])
    })
  })

  describe('selectBestSplit', () => {
    it('best split is never worse than the single best leg (includes degenerate allocation)', () => {
      const total = bn(1_000_000)
      const r = bn(1_000_000)
      const allocations = enumerateAllocations({ total, legs: 2, steps: 10 })
      const best = selectBestSplit({
        allocations,
        outputForLeg: (_i, amount) => ammOut(r, r, amount),
      })
      const singleBest = ammOut(r, r, total)
      expect(best).toBeDefined()
      expect(best!.totalOut.gte(singleBest)).toBe(true)
    })

    it('converges to 50/50 for two identical pools', () => {
      const total = bn(1_000_000)
      const r = bn(1_000_000)
      const best = selectBestSplit({
        allocations: enumerateAllocations({ total, legs: 2, steps: 10 }),
        outputForLeg: (_i, amount) => ammOut(r, r, amount),
      })
      expect(best!.allocation[0]!.toNumber()).toBe(500_000)
      expect(best!.allocation[1]!.toNumber()).toBe(500_000)
      // and the 50/50 split strictly beats the single route
      expect(best!.totalOut.gt(ammOut(r, r, total))).toBe(true)
    })

    it('tilts allocation toward the deeper pool', () => {
      const total = bn(1_000_000)
      const deep = bn(4_000_000)
      const shallow = bn(1_000_000)
      const best = selectBestSplit({
        allocations: enumerateAllocations({ total, legs: 2, steps: 10 }),
        outputForLeg: (i, amount) => (i === 0 ? ammOut(deep, deep, amount) : ammOut(shallow, shallow, amount)),
      })
      // leg 0 is the deeper pool, so it should receive the larger share
      expect(best!.allocation[0]!.gt(best!.allocation[1]!)).toBe(true)
    })

    it('drops allocations where a positive-input leg cannot quote', () => {
      const total = bn(1000)
      const allocations = enumerateAllocations({ total, legs: 2, steps: 10 })
      // leg 1 never quotes -> only the all-on-leg-0 allocation is valid
      const best = selectBestSplit({
        allocations,
        outputForLeg: (i, amount) => (i === 0 ? amount : undefined),
      })
      expect(best!.allocation[0]!.eq(total)).toBe(true)
      expect(best!.allocation[1]!.isZero()).toBe(true)
    })

    it('returns undefined when no allocation is valid', () => {
      const best = selectBestSplit({
        allocations: enumerateAllocations({ total: bn(1000), legs: 2, steps: 10 }),
        outputForLeg: () => undefined,
      })
      expect(best).toBeUndefined()
    })
  })

  describe('passesAcceptGate', () => {
    it('accepts only when the split clears the bps improvement floor', () => {
      // realistic amount so 5 bps is meaningful; threshold = 1_000_000 * 10005/10000 = 1_000_500
      const single = bn(1_000_000)
      expect(passesAcceptGate({ splitOutput: bn(1_000_400), singleBestOutput: single, minImprovementBps: 5 })).toBe(false) // ~4 bps
      expect(passesAcceptGate({ splitOutput: bn(1_000_500), singleBestOutput: single, minImprovementBps: 5 })).toBe(false) // exactly 5 bps, not strictly greater
      expect(passesAcceptGate({ splitOutput: bn(1_000_600), singleBestOutput: single, minImprovementBps: 5 })).toBe(true) // ~6 bps
      expect(passesAcceptGate({ splitOutput: single, singleBestOutput: single, minImprovementBps: 5 })).toBe(false) // no gain
      expect(passesAcceptGate({ splitOutput: bn(999_000), singleBestOutput: single, minImprovementBps: 5 })).toBe(false) // worse
    })

    it('uses integer bps threshold (rounds down)', () => {
      // 1_000_000 * 10005 / 10000 = 1_000_500 -> split must exceed 1_000_500
      expect(
        passesAcceptGate({ splitOutput: bn(1_000_500), singleBestOutput: bn(1_000_000), minImprovementBps: 5 }),
      ).toBe(false)
      expect(
        passesAcceptGate({ splitOutput: bn(1_000_501), singleBestOutput: bn(1_000_000), minImprovementBps: 5 }),
      ).toBe(true)
    })

    it('rejects when the single best output is zero', () => {
      expect(passesAcceptGate({ splitOutput: bn(100), singleBestOutput: bn(0), minImprovementBps: 5 })).toBe(false)
    })
  })

  describe('activeLegCount', () => {
    it('counts only positive-input legs', () => {
      expect(activeLegCount([bn(500), bn(500)])).toBe(2)
      expect(activeLegCount([bn(1000), bn(0)])).toBe(1)
      expect(activeLegCount([bn(0), bn(0)])).toBe(0)
    })
  })
})
