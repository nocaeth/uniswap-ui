import { BigNumber, type BigNumberish } from '@ethersproject/bignumber'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_ETH_CORRELATED_ROUTE_TOKENS,
  GNOSIS_MAX_CANDIDATE_ROUTES,
  GNOSIS_PREFERRED_ETH_ROUTE_HUBS,
  GNOSIS_PREFERRED_STABLE_ROUTE_HUBS,
  GNOSIS_STABLE_ROUTE_TOKENS,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getValidAddress } from 'uniswap/src/utils/addresses'

export interface CandidateRoute {
  tokens: string[]
  fees: FeeAmount[]
}

export interface GnosisPoolGraphEdge {
  tokenA: string
  tokenB: string
  fee: FeeAmount
  liquidity: BigNumberish
  initialized: boolean
  poolAddress?: string
  tvlUSD?: number
}

export interface GnosisViablePoolGraphEdge {
  tokenA: string
  tokenB: string
  fee: FeeAmount
  liquidity: BigNumber
  poolAddress?: string
  tvlUSD?: number
}

export interface GnosisPoolGraph {
  edges: readonly GnosisViablePoolGraphEdge[]
  tokensByAddress: ReadonlyMap<string, string>
  adjacency: ReadonlyMap<string, ReadonlyMap<string, readonly GnosisViablePoolGraphEdge[]>>
}

export interface BuildGnosisRouteCandidatesArgs {
  tokenIn: string
  tokenOut: string
  graph: GnosisPoolGraph
  maxRoutes?: number
  maxHops?: number
  routingHubs?: readonly string[]
}

export interface BuildGnosisRouteCandidatesFromPoolEdgesArgs extends Omit<BuildGnosisRouteCandidatesArgs, 'graph'> {
  poolEdges: readonly GnosisPoolGraphEdge[]
}

interface RankedCandidateRoute {
  route: CandidateRoute
  minimumLiquidity: BigNumber
  preferenceScore: number
  totalFee: number
  routeKey: string
}

export function normalizeGnosisRouteTokenAddress(address: string): string {
  return getValidAddress({ address, platform: Platform.EVM, withEVMChecksum: false }) ?? address
}

function parsePositiveLiquidity(liquidity: BigNumberish): BigNumber | undefined {
  try {
    const parsed = BigNumber.from(liquidity)
    return parsed.gt(0) ? parsed : undefined
  } catch {
    return undefined
  }
}

function getPoolKey({ tokenA, tokenB, fee }: { tokenA: string; tokenB: string; fee: FeeAmount }): string {
  const first = tokenA < tokenB ? tokenA : tokenB
  const second = tokenA < tokenB ? tokenB : tokenA
  return `${first}:${second}:${fee}`
}

function addAdjacencyEdge({
  adjacency,
  from,
  to,
  edge,
}: {
  adjacency: Map<string, Map<string, GnosisViablePoolGraphEdge[]>>
  from: string
  to: string
  edge: GnosisViablePoolGraphEdge
}): void {
  const neighbors = adjacency.get(from) ?? new Map<string, GnosisViablePoolGraphEdge[]>()
  adjacency.set(from, neighbors)

  const edges = neighbors.get(to) ?? []
  edges.push(edge)
  neighbors.set(to, edges)
}

function compareViablePoolEdges(a: GnosisViablePoolGraphEdge, b: GnosisViablePoolGraphEdge): number {
  if (!a.liquidity.eq(b.liquidity)) {
    return a.liquidity.gt(b.liquidity) ? -1 : 1
  }
  return a.fee - b.fee
}

export function buildGnosisPoolGraph(poolEdges: readonly GnosisPoolGraphEdge[]): GnosisPoolGraph {
  const tokensByAddress = new Map<string, string>()
  const viableEdgesByPool = new Map<string, GnosisViablePoolGraphEdge>()

  for (const poolEdge of poolEdges) {
    if (!poolEdge.initialized) {
      continue
    }

    const tokenA = normalizeGnosisRouteTokenAddress(poolEdge.tokenA)
    const tokenB = normalizeGnosisRouteTokenAddress(poolEdge.tokenB)
    if (!tokenA || !tokenB || tokenA === tokenB) {
      continue
    }

    const liquidity = parsePositiveLiquidity(poolEdge.liquidity)
    if (!liquidity) {
      continue
    }

    tokensByAddress.set(tokenA, tokensByAddress.get(tokenA) ?? poolEdge.tokenA)
    tokensByAddress.set(tokenB, tokensByAddress.get(tokenB) ?? poolEdge.tokenB)

    const poolKey = getPoolKey({ tokenA, tokenB, fee: poolEdge.fee })
    const existingEdge = viableEdgesByPool.get(poolKey)
    if (existingEdge && existingEdge.liquidity.gte(liquidity)) {
      continue
    }

    viableEdgesByPool.set(poolKey, {
      tokenA: tokensByAddress.get(tokenA) ?? poolEdge.tokenA,
      tokenB: tokensByAddress.get(tokenB) ?? poolEdge.tokenB,
      fee: poolEdge.fee,
      liquidity,
      poolAddress: poolEdge.poolAddress,
      tvlUSD: poolEdge.tvlUSD,
    })
  }

  const viableEdges = [...viableEdgesByPool.values()].sort((a, b) =>
    getPoolKey({
      tokenA: normalizeGnosisRouteTokenAddress(a.tokenA),
      tokenB: normalizeGnosisRouteTokenAddress(a.tokenB),
      fee: a.fee,
    }).localeCompare(
      getPoolKey({
        tokenA: normalizeGnosisRouteTokenAddress(b.tokenA),
        tokenB: normalizeGnosisRouteTokenAddress(b.tokenB),
        fee: b.fee,
      }),
    ),
  )
  const adjacency = new Map<string, Map<string, GnosisViablePoolGraphEdge[]>>()

  for (const edge of viableEdges) {
    const tokenA = normalizeGnosisRouteTokenAddress(edge.tokenA)
    const tokenB = normalizeGnosisRouteTokenAddress(edge.tokenB)
    addAdjacencyEdge({ adjacency, from: tokenA, to: tokenB, edge })
    addAdjacencyEdge({ adjacency, from: tokenB, to: tokenA, edge })
  }

  for (const neighborEdges of adjacency.values()) {
    for (const edges of neighborEdges.values()) {
      edges.sort(compareViablePoolEdges)
    }
  }

  return { edges: viableEdges, tokensByAddress, adjacency }
}

export function hasGnosisPoolTvlMetadata(poolEdges: readonly GnosisPoolGraphEdge[]): boolean {
  return poolEdges.some((poolEdge) => typeof poolEdge.tvlUSD === 'number' && Number.isFinite(poolEdge.tvlUSD))
}

export function filterGnosisPoolGraphEdgesByTvl(
  poolEdges: readonly GnosisPoolGraphEdge[],
  minimumTvlUSD: number,
): GnosisPoolGraphEdge[] {
  if (minimumTvlUSD <= 0) {
    return [...poolEdges]
  }

  return poolEdges.filter(
    (poolEdge) =>
      typeof poolEdge.tvlUSD === 'number' && Number.isFinite(poolEdge.tvlUSD) && poolEdge.tvlUSD >= minimumTvlUSD,
  )
}

export function buildGnosisRouteCandidatesFromPoolEdges(
  args: BuildGnosisRouteCandidatesFromPoolEdgesArgs,
): CandidateRoute[] {
  return buildGnosisRouteCandidates({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    graph: buildGnosisPoolGraph(args.poolEdges),
    maxRoutes: args.maxRoutes,
    maxHops: args.maxHops,
    routingHubs: args.routingHubs,
  })
}

export function buildGnosisRouteCandidates(args: BuildGnosisRouteCandidatesArgs): CandidateRoute[] {
  const tokenIn = normalizeGnosisRouteTokenAddress(args.tokenIn)
  const tokenOut = normalizeGnosisRouteTokenAddress(args.tokenOut)
  if (!tokenIn || !tokenOut || tokenIn === tokenOut) {
    return []
  }

  const maxRoutes = Math.max(0, Math.trunc(args.maxRoutes ?? GNOSIS_MAX_CANDIDATE_ROUTES))
  if (maxRoutes === 0) {
    return []
  }

  const maxHops = Math.min(3, Math.max(1, Math.trunc(args.maxHops ?? 3)))
  const routingHubs = new Set(
    (args.routingHubs ?? GNOSIS_BASE_TOKENS)
      .map(normalizeGnosisRouteTokenAddress)
      .filter((hub) => hub !== tokenIn && hub !== tokenOut),
  )
  const rankedRoutes: RankedCandidateRoute[] = []
  const visitedTokens = new Set<string>([tokenIn])

  function visit({
    currentToken,
    routeTokens,
    routeFees,
    routeEdges,
  }: {
    currentToken: string
    routeTokens: string[]
    routeFees: FeeAmount[]
    routeEdges: GnosisViablePoolGraphEdge[]
  }): void {
    if (routeFees.length >= maxHops) {
      return
    }

    const neighbors = args.graph.adjacency.get(currentToken)
    if (!neighbors) {
      return
    }

    for (const nextToken of [...neighbors.keys()].sort()) {
      const isOutputToken = nextToken === tokenOut
      if ((!isOutputToken && !routingHubs.has(nextToken)) || visitedTokens.has(nextToken)) {
        continue
      }

      const poolEdges = neighbors.get(nextToken)
      if (!poolEdges) {
        continue
      }

      for (const poolEdge of poolEdges) {
        const nextRouteTokens = [
          ...routeTokens,
          isOutputToken ? args.tokenOut : (args.graph.tokensByAddress.get(nextToken) ?? nextToken),
        ]
        const nextRouteFees = [...routeFees, poolEdge.fee]
        const nextRouteEdges = [...routeEdges, poolEdge]

        if (isOutputToken) {
          const route = { tokens: nextRouteTokens, fees: nextRouteFees }
          rankedRoutes.push(
            createRankedRoute({
              route,
              routeEdges: nextRouteEdges,
              tokenIn,
              tokenOut,
            }),
          )
          continue
        }

        visitedTokens.add(nextToken)
        visit({
          currentToken: nextToken,
          routeTokens: nextRouteTokens,
          routeFees: nextRouteFees,
          routeEdges: nextRouteEdges,
        })
        visitedTokens.delete(nextToken)
      }
    }
  }

  visit({ currentToken: tokenIn, routeTokens: [args.tokenIn], routeFees: [], routeEdges: [] })

  const uniqueRoutes = new Map<string, RankedCandidateRoute>()
  for (const route of rankedRoutes) {
    const existingRoute = uniqueRoutes.get(route.routeKey)
    if (!existingRoute || compareRankedRoutes(route, existingRoute) < 0) {
      uniqueRoutes.set(route.routeKey, route)
    }
  }

  return [...uniqueRoutes.values()]
    .sort(compareRankedRoutes)
    .slice(0, maxRoutes)
    .map((rankedRoute) => rankedRoute.route)
}

function createRankedRoute(args: {
  route: CandidateRoute
  routeEdges: readonly GnosisViablePoolGraphEdge[]
  tokenIn: string
  tokenOut: string
}): RankedCandidateRoute {
  const { route, routeEdges, tokenIn, tokenOut } = args
  return {
    route,
    minimumLiquidity: getMinimumLiquidity(routeEdges),
    preferenceScore: getRoutePreferenceScore({ route, tokenIn, tokenOut }),
    totalFee: route.fees.reduce((sum, fee) => sum + fee, 0),
    routeKey: getRouteKey(route),
  }
}

function getMinimumLiquidity(routeEdges: readonly GnosisViablePoolGraphEdge[]): BigNumber {
  let minimumLiquidity = routeEdges[0]?.liquidity
  if (!minimumLiquidity) {
    return BigNumber.from(0)
  }

  for (const edge of routeEdges.slice(1)) {
    if (edge.liquidity.lt(minimumLiquidity)) {
      minimumLiquidity = edge.liquidity
    }
  }

  return minimumLiquidity
}

function getRoutePreferenceScore(args: { route: CandidateRoute; tokenIn: string; tokenOut: string }): number {
  const { route, tokenIn, tokenOut } = args
  const stableTokens = new Set(GNOSIS_STABLE_ROUTE_TOKENS.map(normalizeGnosisRouteTokenAddress))
  const ethCorrelatedTokens = new Set(GNOSIS_ETH_CORRELATED_ROUTE_TOKENS.map(normalizeGnosisRouteTokenAddress))
  const intermediateTokens = route.tokens.slice(1, -1).map(normalizeGnosisRouteTokenAddress)

  if (stableTokens.has(tokenIn) && stableTokens.has(tokenOut)) {
    return getHubPreferenceScore(intermediateTokens, GNOSIS_PREFERRED_STABLE_ROUTE_HUBS)
  }

  if (ethCorrelatedTokens.has(tokenIn) || ethCorrelatedTokens.has(tokenOut)) {
    return getHubPreferenceScore(intermediateTokens, GNOSIS_PREFERRED_ETH_ROUTE_HUBS)
  }

  return 0
}

function getHubPreferenceScore(routeTokens: readonly string[], preferredHubs: readonly string[]): number {
  const preferredHubScores = new Map(
    preferredHubs.map((hub, index) => [normalizeGnosisRouteTokenAddress(hub), preferredHubs.length - index]),
  )
  return routeTokens.reduce((score, token) => score + (preferredHubScores.get(token) ?? 0), 0)
}

function getRouteKey(route: CandidateRoute): string {
  return `${route.tokens.map(normalizeGnosisRouteTokenAddress).join(':')}|${route.fees.join(':')}`
}

function compareRankedRoutes(a: RankedCandidateRoute, b: RankedCandidateRoute): number {
  const hopDelta = a.route.fees.length - b.route.fees.length
  if (hopDelta !== 0) {
    return hopDelta
  }

  if (!a.minimumLiquidity.eq(b.minimumLiquidity)) {
    return a.minimumLiquidity.gt(b.minimumLiquidity) ? -1 : 1
  }

  const preferenceDelta = b.preferenceScore - a.preferenceScore
  if (preferenceDelta !== 0) {
    return preferenceDelta
  }

  const feeDelta = a.totalFee - b.totalFee
  if (feeDelta !== 0) {
    return feeDelta
  }

  return a.routeKey.localeCompare(b.routeKey)
}
