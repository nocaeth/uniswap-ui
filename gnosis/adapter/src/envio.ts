/**
 * Thin GraphQL client for the Envio indexer's Hasura endpoint (gnosis/envio).
 * Envio exposes one row type per entity defined in gnosis/envio/schema.graphql.
 */
const ENVIO_GRAPHQL_URL = process.env.ENVIO_GRAPHQL_URL ?? 'http://localhost:8080/v1/graphql'

export async function envioQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENVIO_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`Envio GraphQL ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { data?: T; errors?: unknown }
  if (json.errors) {
    throw new Error(`Envio GraphQL errors: ${JSON.stringify(json.errors)}`)
  }
  if (!json.data) {
    throw new Error('Envio GraphQL returned no data')
  }
  return json.data
}

// ---- Row types (mirror gnosis/envio/schema.graphql) ----

export interface EnvioToken {
  id: string
  symbol: string
  name: string
  decimals: number
  totalValueLockedUSD: number
  volumeUSD: number
  txCount: number
  derivedXDAI: number
}

export interface EnvioPool {
  id: string
  feeTier: number
  totalValueLockedUSD: number
  volumeUSD: number
  txCount: number
  token0: EnvioToken
  token1: EnvioToken
}

export interface EnvioTokenDayData {
  date: number
  priceUSD: number
  volumeUSD: number
}

export interface EnvioProtocolStats {
  totalValueLockedUSD: number
  volumeUSD: number
  txCount: number
  poolCount: number
}

const TOKEN_FIELDS = `id symbol name decimals totalValueLockedUSD volumeUSD txCount derivedXDAI`

/** Top tokens for the Explore tokens table. */
export function fetchTopTokens(limit = 100): Promise<{ Token: EnvioToken[] }> {
  return envioQuery(
    `query Tokens($limit: Int!) {
       Token(limit: $limit, order_by: { totalValueLockedUSD: desc }) { ${TOKEN_FIELDS} }
     }`,
    { limit },
  )
}

/** Top pools for the Explore pools table. */
export function fetchTopPools(limit = 100): Promise<{ Pool: EnvioPool[] }> {
  return envioQuery(
    `query Pools($limit: Int!) {
       Pool(limit: $limit, order_by: { totalValueLockedUSD: desc }) {
         id feeTier totalValueLockedUSD volumeUSD txCount
         token0 { ${TOKEN_FIELDS} }
         token1 { ${TOKEN_FIELDS} }
       }
     }`,
    { limit },
  )
}

/** Daily price/volume points for a token's charts. */
export function fetchTokenDayData(tokenId: string, days = 365): Promise<{ TokenDayData: EnvioTokenDayData[] }> {
  return envioQuery(
    `query TokenDays($id: String!, $days: Int!) {
       TokenDayData(where: { token_id: { _eq: $id } }, order_by: { date: asc }, limit: $days) {
         date priceUSD volumeUSD
       }
     }`,
    { id: tokenId.toLowerCase(), days },
  )
}

export function fetchProtocolStats(): Promise<{ ProtocolStats: EnvioProtocolStats[] }> {
  return envioQuery(`query { ProtocolStats(limit: 1) { totalValueLockedUSD volumeUSD txCount poolCount } }`)
}
