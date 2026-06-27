import { config } from 'uniswap/src/config'
import { getUniswapServiceUrls } from 'uniswap/src/constants/urls'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import type { GnosisPoolGraphEdge } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'
import { getValidAddress } from 'uniswap/src/utils/addresses'

const POOL_TVL_CACHE_TTL_MS = 60_000
const POOL_TVL_FETCH_TIMEOUT_MS = 800

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
}
