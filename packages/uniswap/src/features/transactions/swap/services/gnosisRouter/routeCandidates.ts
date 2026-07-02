/* oxlint-disable max-lines -- cohesive Gnosis graph/ranking module; splitting comparator helpers would obscure the route ranking flow */
import { BigNumber, type BigNumberish } from '@ethersproject/bignumber'
import { FeeAmount } from '@uniswap/v3-sdk'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { getGnosisSharedStateTokenAddresses } from 'uniswap/src/features/tokens/gnosisCanonicalTokens'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_ETH_CORRELATED_ROUTE_TOKENS,
  GNOSIS_MAX_CANDIDATE_ROUTES,
  GNOSIS_MAX_POOLS_PER_PAIR,
  GNOSIS_MAX_ROUTE_HOPS,
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
  // Pool spot state (from slot0), retained for cheap (no extra RPC) price-impact estimation.
  sqrtPriceX96?: BigNumber
  tick?: number
}

export interface GnosisViablePoolGraphEdge {
  tokenA: string
  tokenB: string
  fee: FeeAmount
  liquidity: BigNumber
  poolAddress?: string
  tvlUSD?: number
  sqrtPriceX96?: BigNumber
  tick?: number
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
  minimumTvlUSD?: number
  spotPricePenalty?: number
  preferenceScore: number
  totalFee: number
  routeKey: string
}

export function normalizeGnosisRouteTokenAddress(address: string): string {
  return getValidAddress({ address, platform: Platform.EVM, withEVMChecksum: false }) ?? address
}

function getGnosisRouteEquivalentAddresses(address: string): string[] {
  return [
    ...new Set(
      getGnosisSharedStateTokenAddresses({ chainId: UniverseChainId.Gnosis, address }).map(
        normalizeGnosisRouteTokenAddress,
      ),
    ),
  ]
}

function getGnosisRouteEquivalentAddressSet(addresses: readonly string[]): Set<string> {
  return new Set(addresses.flatMap(getGnosisRouteEquivalentAddresses))
}

function getRouteGraphToken(args: { graph: GnosisPoolGraph; normalizedAddress: string; fallback: string }): string {
  return args.graph.tokensByAddress.get(args.normalizedAddress) ?? args.fallback
}

function parsePositiveLiquidity(liquidity: BigNumberish): BigNumber | undefined {
  try {
    const parsed = BigNumber.from(liquidity)
    return parsed.gt(0) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function getPoolKey({ tokenA, tokenB, fee }: { tokenA: string; tokenB: string; fee: FeeAmount }): string {
  const first = tokenA < tokenB ? tokenA : tokenB
  const second = tokenA < tokenB ? tokenB : tokenA
  return `${first}:${second}:${fee}`
}

/** Canonical pool key for a route hop, normalizing both token addresses first (getPoolKey does not). */
export function getRoutePoolKey({ tokenA, tokenB, fee }: { tokenA: string; tokenB: string; fee: FeeAmount }): string {
  return getPoolKey({
    tokenA: normalizeGnosisRouteTokenAddress(tokenA),
    tokenB: normalizeGnosisRouteTokenAddress(tokenB),
    fee,
  })
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
      sqrtPriceX96: poolEdge.sqrtPriceX96,
      tick: poolEdge.tick,
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

  return poolEdges.filter((poolEdge) => {
    if (typeof poolEdge.tvlUSD !== 'number' || !Number.isFinite(poolEdge.tvlUSD)) {
      return true
    }

    return poolEdge.tvlUSD >= minimumTvlUSD
  })
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
  const maxRoutes = Math.max(0, Math.trunc(args.maxRoutes ?? GNOSIS_MAX_CANDIDATE_ROUTES))
  if (maxRoutes === 0) {
    return []
  }

  const maxHops = Math.min(GNOSIS_MAX_ROUTE_HOPS, Math.max(1, Math.trunc(args.maxHops ?? GNOSIS_MAX_ROUTE_HOPS)))
  const tokenIns = getGnosisRouteEquivalentAddresses(args.tokenIn)
  const tokenOuts = getGnosisRouteEquivalentAddresses(args.tokenOut)
  const routeHubCandidates = [...getGnosisRouteEquivalentAddressSet(args.routingHubs ?? GNOSIS_BASE_TOKENS)]
  const rankedRoutes: RankedCandidateRoute[] = []

  for (const tokenIn of tokenIns) {
    for (const tokenOut of tokenOuts) {
      if (!tokenIn || !tokenOut || tokenIn === tokenOut) {
        continue
      }

      rankedRoutes.push(
        ...buildRankedGnosisRouteCandidates({
          graph: args.graph,
          tokenIn,
          tokenOut,
          maxHops,
          routingHubs: routeHubCandidates.filter((hub) => hub !== tokenIn && hub !== tokenOut),
        }),
      )
    }
  }

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

function buildRankedGnosisRouteCandidates(args: {
  graph: GnosisPoolGraph
  tokenIn: string
  tokenOut: string
  maxHops: number
  routingHubs: readonly string[]
}): RankedCandidateRoute[] {
  const rankedRoutes: RankedCandidateRoute[] = []
  const visitedTokens = new Set<string>([args.tokenIn])
  const routingHubs = new Set(args.routingHubs)

  function visit(params: {
    currentToken: string
    routeTokens: string[]
    routeFees: FeeAmount[]
    routeEdges: GnosisViablePoolGraphEdge[]
  }): void {
    const { currentToken, routeTokens, routeFees, routeEdges } = params
    if (routeFees.length >= args.maxHops) {
      return
    }

    const neighbors = args.graph.adjacency.get(currentToken)
    if (!neighbors) {
      return
    }

    for (const nextToken of [...neighbors.keys()].sort()) {
      const isOutputToken = nextToken === args.tokenOut
      if ((!isOutputToken && !routingHubs.has(nextToken)) || visitedTokens.has(nextToken)) {
        continue
      }

      const poolEdges = neighbors.get(nextToken)
      if (!poolEdges) {
        continue
      }

      // Only the deepest few fee tiers per pair; edges are pre-sorted by liquidity (compareViablePoolEdges).
      for (const poolEdge of poolEdges.slice(0, GNOSIS_MAX_POOLS_PER_PAIR)) {
        const nextRouteTokens = [
          ...routeTokens,
          isOutputToken
            ? getRouteGraphToken({ graph: args.graph, normalizedAddress: args.tokenOut, fallback: args.tokenOut })
            : getRouteGraphToken({ graph: args.graph, normalizedAddress: nextToken, fallback: nextToken }),
        ]
        const nextRouteFees = [...routeFees, poolEdge.fee]
        const nextRouteEdges = [...routeEdges, poolEdge]

        if (isOutputToken) {
          const route = { tokens: nextRouteTokens, fees: nextRouteFees }
          rankedRoutes.push(
            createRankedRoute({
              route,
              routeEdges: nextRouteEdges,
              tokenIn: args.tokenIn,
              tokenOut: args.tokenOut,
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

  visit({
    currentToken: args.tokenIn,
    routeTokens: [getRouteGraphToken({ graph: args.graph, normalizedAddress: args.tokenIn, fallback: args.tokenIn })],
    routeFees: [],
    routeEdges: [],
  })

  return rankedRoutes
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
    minimumTvlUSD: getMinimumTvlUSD(routeEdges),
    spotPricePenalty: getRouteSpotPricePenalty({ route, routeEdges }),
    preferenceScore: getRoutePreferenceScore({ route, tokenIn, tokenOut }),
    totalFee: route.fees.reduce((sum, fee) => sum + fee, 0),
    routeKey: getGnosisRouteKey(route),
  }
}

function getRouteSpotPricePenalty(args: {
  route: CandidateRoute
  routeEdges: readonly GnosisViablePoolGraphEdge[]
}): number | undefined {
  let logSpotRate = 0

  for (const [index, edge] of args.routeEdges.entries()) {
    const tokenIn = args.route.tokens[index]
    const tokenOut = args.route.tokens[index + 1]
    if (!tokenIn || !tokenOut) {
      return undefined
    }

    const hopLogSpotRate = getEdgeLogSpotRate({ edge, tokenIn, tokenOut })
    if (hopLogSpotRate === undefined) {
      return undefined
    }
    logSpotRate += hopLogSpotRate
  }

  return -logSpotRate
}

function getEdgeLogSpotRate(args: {
  edge: GnosisViablePoolGraphEdge
  tokenIn: string
  tokenOut: string
}): number | undefined {
  const { edge } = args
  if (!edge.sqrtPriceX96 || edge.sqrtPriceX96.lte(0)) {
    return undefined
  }

  const tokenA = normalizeGnosisRouteTokenAddress(edge.tokenA)
  const tokenB = normalizeGnosisRouteTokenAddress(edge.tokenB)
  const tokenIn = normalizeGnosisRouteTokenAddress(args.tokenIn)
  const tokenOut = normalizeGnosisRouteTokenAddress(args.tokenOut)
  if (!tokenA || !tokenB || !tokenIn || !tokenOut || tokenA === tokenB) {
    return undefined
  }

  const token0 = tokenA < tokenB ? tokenA : tokenB
  const token1 = tokenA < tokenB ? tokenB : tokenA
  const sqrtPrice = Number(edge.sqrtPriceX96.toString())
  if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0) {
    return undefined
  }

  const logToken1PerToken0 = 2 * (Math.log(sqrtPrice) - 96 * Math.log(2))
  if (!Number.isFinite(logToken1PerToken0)) {
    return undefined
  }

  if (tokenIn === token0 && tokenOut === token1) {
    return logToken1PerToken0
  }
  if (tokenIn === token1 && tokenOut === token0) {
    return -logToken1PerToken0
  }

  return undefined
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

function getMinimumTvlUSD(routeEdges: readonly GnosisViablePoolGraphEdge[]): number | undefined {
  let minimumTvlUSD: number | undefined

  for (const edge of routeEdges) {
    if (typeof edge.tvlUSD !== 'number' || !Number.isFinite(edge.tvlUSD)) {
      return undefined
    }

    minimumTvlUSD = minimumTvlUSD === undefined ? edge.tvlUSD : Math.min(minimumTvlUSD, edge.tvlUSD)
  }

  return minimumTvlUSD
}

function getRoutePreferenceScore(args: { route: CandidateRoute; tokenIn: string; tokenOut: string }): number {
  const { route, tokenIn, tokenOut } = args
  const stableTokens = getGnosisRouteEquivalentAddressSet(GNOSIS_STABLE_ROUTE_TOKENS)
  const ethCorrelatedTokens = getGnosisRouteEquivalentAddressSet(GNOSIS_ETH_CORRELATED_ROUTE_TOKENS)
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
    preferredHubs.flatMap((hub, index) =>
      getGnosisRouteEquivalentAddresses(hub).map((equivalentHub) => [equivalentHub, preferredHubs.length - index]),
    ),
  )
  return routeTokens.reduce((score, token) => score + (preferredHubScores.get(token) ?? 0), 0)
}

export function getGnosisRouteKey(route: CandidateRoute): string {
  return `${route.tokens.map(normalizeGnosisRouteTokenAddress).join(':')}|${route.fees.join(':')}`
}

function compareRankedRoutes(a: RankedCandidateRoute, b: RankedCandidateRoute): number {
  const hopDelta = a.route.fees.length - b.route.fees.length
  if (hopDelta !== 0) {
    return hopDelta
  }

  // Total-ordered spot comparison applied once, before the TVL check.
  // Routes whose marginal price couldn't be computed (undefined/non-finite) map to +Infinity
  // so they rank last on the price criterion.  This preserves the "better spot beats higher TVL"
  // design while making the comparator a provably total/transitive order.
  const spotA =
    a.spotPricePenalty !== undefined && Number.isFinite(a.spotPricePenalty)
      ? a.spotPricePenalty
      : Number.POSITIVE_INFINITY
  const spotB =
    b.spotPricePenalty !== undefined && Number.isFinite(b.spotPricePenalty)
      ? b.spotPricePenalty
      : Number.POSITIVE_INFINITY
  if (spotA !== spotB) {
    return spotA < spotB ? -1 : 1
  }

  if (a.minimumTvlUSD !== undefined && b.minimumTvlUSD !== undefined && a.minimumTvlUSD !== b.minimumTvlUSD) {
    return b.minimumTvlUSD - a.minimumTvlUSD
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
