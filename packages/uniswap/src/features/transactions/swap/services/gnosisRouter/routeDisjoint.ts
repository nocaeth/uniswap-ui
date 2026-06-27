import type { CandidateRoute } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'

/**
 * Pool-disjointness for split-fill routing (spec §3.1).
 *
 * Two v3 routes may only have their independently-quoted outputs summed if they share NO pool —
 * otherwise the shared pool's depth is double-counted and the combined quote overstates output
 * (the chain would under-deliver). A pool is keyed by the canonical tuple
 * `(min(tokenA,tokenB), max(tokenA,tokenB), fee)` over the routes' already-resolved concrete token
 * addresses, so shared-state pools (e.g. EURe-v1 vs EURe-v2) are genuinely different pools and are
 * legitimately disjoint. Routes that merely share a *token* (but not a pool) are disjoint.
 */

function poolKey(pool: { tokenA: string; tokenB: string; fee: number }): string {
  const a = pool.tokenA.toLowerCase()
  const b = pool.tokenB.toLowerCase()
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${lo}-${hi}-${pool.fee}`
}

/** The set of canonical pool keys a route touches — one per hop. */
export function routePoolKeys(route: CandidateRoute): Set<string> {
  const keys = new Set<string>()
  for (let i = 0; i < route.fees.length; i++) {
    const a = route.tokens[i]
    const b = route.tokens[i + 1]
    const fee = route.fees[i]
    if (a === undefined || b === undefined || fee === undefined) {
      continue
    }
    keys.add(poolKey({ tokenA: a, tokenB: b, fee }))
  }
  return keys
}

/** True iff the two routes share no pool. */
export function arePoolDisjoint(a: CandidateRoute, b: CandidateRoute): boolean {
  const aKeys = routePoolKeys(a)
  for (const key of routePoolKeys(b)) {
    if (aKeys.has(key)) {
      return false
    }
  }
  return true
}

/**
 * Greedily pick up to `maxLegs` mutually pool-disjoint routes from a ranked list (best first),
 * always keeping the best route. Each candidate is added only if it is disjoint from every route
 * already chosen, so the returned set can be split across without double-counting any pool.
 */
export function pickDisjointSet(ranked: readonly CandidateRoute[], maxLegs: number): CandidateRoute[] {
  const chosen: CandidateRoute[] = []
  for (const route of ranked) {
    if (chosen.length >= maxLegs) {
      break
    }
    if (chosen.every((picked) => arePoolDisjoint(picked, route))) {
      chosen.push(route)
    }
  }
  return chosen
}
