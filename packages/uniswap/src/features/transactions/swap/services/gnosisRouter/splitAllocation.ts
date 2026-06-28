import { BigNumber } from '@ethersproject/bignumber'
import { BIPS_BASE } from 'uniswap/src/constants/misc'

/**
 * Pure split-fill allocation math (spec §4). Quoting (the Multicall3) lives in fetchGnosisQuote;
 * everything here is deterministic and unit-tested: enumerate candidate allocations on a simplex
 * grid, score them against per-leg quoted outputs, and apply the net-of-gas accept gate (which on
 * Gnosis collapses to a token-improvement floor, since gas is negligible).
 */

/** All non-negative integer compositions of `total` into `parts` ordered slots (each sums to total). */
function compositions(total: number, parts: number): number[][] {
  if (parts <= 1) {
    return [[total]]
  }
  const result: number[][] = []
  for (let head = 0; head <= total; head++) {
    for (const tail of compositions(total - head, parts - 1)) {
      result.push([head, ...tail])
    }
  }
  return result
}

/**
 * Enumerate candidate input allocations for a split across `legs` routes as a simplex grid of
 * resolution `steps`. Each allocation is a per-leg input array that sums EXACTLY to `total`
 * (conservation of input, spec §3.2). Integer division leaves a sub-grid remainder; it is assigned
 * to `deepestLegIndex` (the highest-liquidity leg) so no input wei is lost. For `legs = 2` this is
 * `steps + 1` allocations from all-on-leg-1 to all-on-leg-0.
 */
export function enumerateAllocations(args: {
  total: BigNumber
  legs: number
  steps: number
  deepestLegIndex?: number
}): BigNumber[][] {
  const { total, legs, steps } = args
  if (legs < 1 || steps < 1) {
    return []
  }
  const idx =
    args.deepestLegIndex !== undefined && args.deepestLegIndex >= 0 && args.deepestLegIndex < legs
      ? args.deepestLegIndex
      : 0

  const allocations: BigNumber[][] = []
  for (const composition of compositions(steps, legs)) {
    const amounts = composition.map((c) => total.mul(c).div(steps))
    const assigned = amounts.reduce((sum, a) => sum.add(a), BigNumber.from(0))
    amounts[idx] = (amounts[idx] ?? BigNumber.from(0)).add(total.sub(assigned))
    allocations.push(amounts)
  }
  return allocations
}

export interface ScoredAllocation {
  allocation: BigNumber[]
  totalOut: BigNumber
}

/**
 * Score each allocation by summing per-leg outputs and return the highest-output one.
 * `outputForLeg(legIndex, amount)` returns the quoted output for that leg at that input amount, or
 * `undefined` if the leg has no quote at that size. A zero-input leg contributes zero. An allocation
 * with any positive-input leg that failed to quote is dropped (it cannot be summed safely).
 *
 * Because the all-on-the-best-leg allocation is included, the returned `totalOut` is always ≥ the
 * single best route's output — `passesAcceptGate` then decides whether the split is worth using.
 */
export function selectBestSplit(args: {
  allocations: BigNumber[][]
  outputForLeg: (legIndex: number, amount: BigNumber) => BigNumber | undefined
}): ScoredAllocation | undefined {
  const { allocations, outputForLeg } = args
  let best: ScoredAllocation | undefined
  for (const allocation of allocations) {
    let total = BigNumber.from(0)
    let valid = true
    for (let i = 0; i < allocation.length; i++) {
      const amount = allocation[i] ?? BigNumber.from(0)
      if (amount.isZero()) {
        continue
      }
      const out = outputForLeg(i, amount)
      if (out === undefined) {
        valid = false
        break
      }
      total = total.add(out)
    }
    if (valid && (!best || total.gt(best.totalOut))) {
      best = { allocation, totalOut: total }
    }
  }
  return best
}

/**
 * Accept gate (spec §3.4 / §4.5). Gnosis gas is negligible, so the gate is purely a token-gain
 * floor: the split output must beat the single best route by at least `minImprovementBps`.
 */
export function passesAcceptGate(args: {
  splitOutput: BigNumber
  singleBestOutput: BigNumber
  minImprovementBps: number
}): boolean {
  const { splitOutput, singleBestOutput, minImprovementBps } = args
  if (singleBestOutput.isZero()) {
    return false
  }
  const threshold = singleBestOutput.mul(BIPS_BASE + minImprovementBps).div(BIPS_BASE)
  return splitOutput.gt(threshold)
}

/** Number of legs that receive a positive input in an allocation (1 = effectively single-route). */
export function activeLegCount(allocation: readonly BigNumber[]): number {
  return allocation.filter((a) => !a.isZero()).length
}
