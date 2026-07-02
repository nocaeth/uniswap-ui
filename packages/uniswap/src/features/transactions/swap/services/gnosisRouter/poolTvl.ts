import { config } from 'uniswap/src/config'
import { getUniswapServiceUrls } from 'uniswap/src/constants/urls'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import type { GnosisPoolGraphEdge } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import { getValidAddress } from 'uniswap/src/utils/addresses'

const POOL_TVL_CACHE_TTL_MS = 60_000
const POOL_TVL_FETCH_TIMEOUT_MS = 800
// The Gnosis pool universe is order tens of pools; one page fetches everything the adapter indexes.
const TOP_POOLS_PAGE_SIZE = 200

interface CachedPoolTvl {
  tvlUSD?: number
  ts: number
}

interface GnosisPoolTvlPool {
  address?: string | null
  totalLiquidity?: {
    value?: number | string | null
  } | null
}

interface GnosisPoolTvlGraphQlResponse {
  data?: Record<string, GnosisPoolTvlPool | null>
}

interface GnosisPoolTvlQuery {
  aliases: string[]
  query: string
  variables: Record<string, string>
}

const poolTvlCache = new Map<string, CachedPoolTvl>()

function normalizePoolAddress(address: string | undefined): string | undefined {
  return getValidAddress({ address, platform: Platform.EVM, withEVMChecksum: false }) ?? undefined
}

function parseTvlUSD(value: number | string | null | undefined): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined
}

function getUniquePoolAddresses(poolAddresses: readonly string[]): string[] {
  return [...new Set(poolAddresses.map(normalizePoolAddress).filter((address): address is string => Boolean(address)))]
}

function buildPoolTvlQuery(poolAddresses: readonly string[]): GnosisPoolTvlQuery {
  const aliases: string[] = []
  const variables: Record<string, string> = {}
  const fields: string[] = []
  const variableDefinitions: string[] = []

  poolAddresses.forEach((address, index) => {
    const alias = `pool${index}`
    aliases.push(alias)
    variables[alias] = address
    variableDefinitions.push(`$${alias}: String!`)
    fields.push(`${alias}: v3Pool(chain: ETHEREUM, address: $${alias}) { address totalLiquidity { value } }`)
  })

  return {
    aliases,
    variables,
    query: `query GnosisPoolTvls(${variableDefinitions.join(', ')}) { ${fields.join(' ')} }`,
  }
}

function negativeCachePoolTvls(poolAddresses: readonly string[], ts: number): void {
  for (const address of poolAddresses) {
    poolTvlCache.set(address, { ts })
  }
}

export async function fetchGnosisPoolTvlUSDByAddress(
  poolAddresses: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const now = Date.now()
  const tvls = new Map<string, number>()
  const missingPoolAddresses: string[] = []

  for (const address of getUniquePoolAddresses(poolAddresses)) {
    const cached = poolTvlCache.get(address)
    if (cached && now - cached.ts < POOL_TVL_CACHE_TTL_MS) {
      if (cached.tvlUSD !== undefined) {
        tvls.set(address, cached.tvlUSD)
      }
      continue
    }

    missingPoolAddresses.push(address)
  }

  if (!missingPoolAddresses.length || !config.graphqlUrlOverride) {
    return tvls
  }

  const request = buildPoolTvlQuery(missingPoolAddresses)
  const abortController = typeof AbortController === 'undefined' ? undefined : new AbortController()
  const abortTimeout = abortController
    ? setTimeout(() => abortController.abort(), POOL_TVL_FETCH_TIMEOUT_MS)
    : undefined

  try {
    const response = await fetch(getUniswapServiceUrls(config).graphQLUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: request.query, variables: request.variables }),
      signal: abortController?.signal,
    })

    if (!response.ok) {
      negativeCachePoolTvls(missingPoolAddresses, now)
      return tvls
    }

    const body = (await response.json()) as GnosisPoolTvlGraphQlResponse
    request.aliases.forEach((alias, index) => {
      const requestedAddress = missingPoolAddresses[index]
      if (!requestedAddress) {
        return
      }

      const pool = body.data?.[alias]
      const poolAddress = normalizePoolAddress(pool?.address ?? undefined) ?? requestedAddress
      const tvlUSD = parseTvlUSD(pool?.totalLiquidity?.value)
      poolTvlCache.set(poolAddress, { tvlUSD, ts: now })

      if (tvlUSD !== undefined) {
        tvls.set(poolAddress, tvlUSD)
      }
    })

    for (const requestedAddress of missingPoolAddresses) {
      if (!poolTvlCache.has(requestedAddress)) {
        poolTvlCache.set(requestedAddress, { ts: now })
      }
    }
  } catch {
    negativeCachePoolTvls(missingPoolAddresses, now)
    return tvls
  } finally {
    if (abortTimeout) {
      clearTimeout(abortTimeout)
    }
  }

  return tvls
}

export interface GnosisTopPoolToken {
  address: string
  symbol?: string
  // Adapter-sourced decimals are UNVERIFIED (unknown tokens fall back to 18 server-side): usable
  // for candidate ranking only, never for price-impact math or quote execution — those read
  // KNOWN_TOKENS or the on-chain tokenMetaCache (prefetchGnosisTokenMetas).
  decimals?: number
}

export interface GnosisTopPool {
  address: string
  fee: number
  tvlUSD?: number
  token0: GnosisTopPoolToken
  token1: GnosisTopPoolToken
}

interface GnosisTopPoolsGraphQlResponse {
  data?: {
    topV3Pools?:
      | ({
          address?: string | null
          feeTier?: number | string | null
          totalLiquidity?: { value?: number | string | null } | null
          token0?: { address?: string | null; symbol?: string | null; decimals?: number | string | null } | null
          token1?: { address?: string | null; symbol?: string | null; decimals?: number | string | null } | null
        } | null)[]
      | null
  }
}

const TOP_POOLS_QUERY = `query GnosisTopV3Pools($first: Int!) { topV3Pools(chain: ETHEREUM, first: $first) { address feeTier totalLiquidity { value } token0 { address symbol decimals } token1 { address symbol decimals } } }`

let topPoolsCache: { pools: GnosisTopPool[] | undefined; ts: number } | undefined

function parseDecimals(value: number | string | null | undefined): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parseTopPoolToken(token: {
  address?: string | null
  symbol?: string | null
  decimals?: number | string | null
}): GnosisTopPoolToken | undefined {
  const address = normalizePoolAddress(token.address ?? undefined)
  if (!address) {
    return undefined
  }
  return { address, symbol: token.symbol ?? undefined, decimals: parseDecimals(token.decimals) }
}

/** Parses/validates topV3Pools entries, committing each pool's TVL to the per-pool cache. */
function parseTopPoolsResponse(args: { body: GnosisTopPoolsGraphQlResponse; now: number }): GnosisTopPool[] {
  const pools: GnosisTopPool[] = []
  for (const pool of args.body.data?.topV3Pools ?? []) {
    const address = normalizePoolAddress(pool?.address ?? undefined)
    const fee = typeof pool?.feeTier === 'string' ? Number(pool.feeTier) : (pool?.feeTier ?? undefined)
    const token0 = pool?.token0 ? parseTopPoolToken(pool.token0) : undefined
    const token1 = pool?.token1 ? parseTopPoolToken(pool.token1) : undefined
    if (!address || fee === undefined || !Number.isFinite(fee) || !token0 || !token1) {
      continue
    }
    const tvlUSD = parseTvlUSD(pool?.totalLiquidity?.value)
    pools.push({ address, fee, tvlUSD, token0, token1 })
    poolTvlCache.set(address, { tvlUSD, ts: args.now })
  }
  return pools
}

/**
 * The full V3 pool set the Gnosis analytics adapter has indexed (TVL-descending), or undefined
 * when the adapter is unconfigured, unreachable, or empty — callers fall back to on-chain factory
 * discovery. Results (including failures) are cached for POOL_TVL_CACHE_TTL_MS, and every returned
 * pool's TVL is committed to the per-pool TVL cache so a subsequent
 * annotateGnosisPoolGraphEdgesWithTvl over the same pools is pure cache hits (no second fetch).
 */
export async function fetchGnosisTopV3Pools(): Promise<GnosisTopPool[] | undefined> {
  const now = Date.now()
  if (topPoolsCache && now - topPoolsCache.ts < POOL_TVL_CACHE_TTL_MS) {
    return topPoolsCache.pools
  }
  if (!config.graphqlUrlOverride) {
    return undefined
  }

  const abortController = typeof AbortController === 'undefined' ? undefined : new AbortController()
  const abortTimeout = abortController
    ? setTimeout(() => abortController.abort(), POOL_TVL_FETCH_TIMEOUT_MS)
    : undefined

  try {
    const response = await fetch(getUniswapServiceUrls(config).graphQLUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TOP_POOLS_QUERY, variables: { first: TOP_POOLS_PAGE_SIZE } }),
      signal: abortController?.signal,
    })

    if (!response.ok) {
      topPoolsCache = { pools: undefined, ts: now }
      return undefined
    }

    const body = (await response.json()) as GnosisTopPoolsGraphQlResponse
    const pools = parseTopPoolsResponse({ body, now })

    // An empty result means the adapter has not backfilled pools yet — treat as unavailable so
    // discovery falls back to factory probing rather than an empty graph.
    topPoolsCache = { pools: pools.length ? pools : undefined, ts: now }
    return topPoolsCache.pools
  } catch {
    topPoolsCache = { pools: undefined, ts: now }
    return undefined
  } finally {
    if (abortTimeout) {
      clearTimeout(abortTimeout)
    }
  }
}

export async function annotateGnosisPoolGraphEdgesWithTvl(
  poolEdges: readonly GnosisPoolGraphEdge[],
): Promise<GnosisPoolGraphEdge[]> {
  const tvls = await fetchGnosisPoolTvlUSDByAddress(
    poolEdges.map((poolEdge) => poolEdge.poolAddress).filter((address): address is string => Boolean(address)),
  )

  if (!tvls.size) {
    return [...poolEdges]
  }

  return poolEdges.map((poolEdge) => {
    const poolAddress = normalizePoolAddress(poolEdge.poolAddress)
    const tvlUSD = poolAddress ? tvls.get(poolAddress) : undefined
    return tvlUSD === undefined ? poolEdge : { ...poolEdge, tvlUSD }
  })
}

export function clearGnosisPoolTvlCache(): void {
  poolTvlCache.clear()
  topPoolsCache = undefined
}
