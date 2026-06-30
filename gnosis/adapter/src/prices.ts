import { createPublicClient, getAddress, http, type Address, type PublicClient } from 'viem'
import { gnosis } from 'viem/chains'
import { getTokenRow } from './envio.js'
import { deriveOsgnoPriceUsd, fetchOsgnoRate, GNO_ADDRESS, isOsgnoAddress } from './osgnoOracle.js'

const RPC_URL =
  process.env.POSITIONS_RPC_URL ?? process.env.GNOSIS_RPC_URL ?? process.env.RPC_GNOSIS ?? 'http://localhost:8545'

const client: PublicClient = createPublicClient({ chain: gnosis, transport: http(RPC_URL) })

const MAX_PRICE_USD = 1_000_000
const OSGNO_RATE_CACHE_MS = 60_000
const DEFILLAMA_PRICE_CACHE_MS = Number(process.env.DEFILLAMA_PRICE_CACHE_MS ?? 5 * 60_000)
const DEFILLAMA_PRICE_TIMEOUT_MS = Number(process.env.DEFILLAMA_PRICE_TIMEOUT_MS ?? 5_000)
const DEFILLAMA_PRICE_API = process.env.DEFILLAMA_PRICE_API ?? 'https://coins.llama.fi/prices/current'

const GBPE_CANONICAL_ADDRESS = getAddress('0x8E34bfEC4f6Eb781f9743D9b4af99CD23F9b7053')
const GBPE_LEGACY_ADDRESS = getAddress('0x5Cb9073902F2035222B9749F8fB0c9BFe5527108')

const ADDRESS_PRICE_ALIASES = new Map<string, Address>([
  // The live GBPe liquidity/indexed row is still the legacy Monerium token.
  [addressKey(GBPE_CANONICAL_ADDRESS), GBPE_LEGACY_ADDRESS],
])

const DEFILLAMA_PRICE_IDS_BY_ADDRESS = new Map<string, string>([
  [addressKey('0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430'), 'coingecko:monerium-eur-money'], // EURe
  [addressKey('0xcB444e90D8198415266c6a2724b7900fb12FC56E'), 'coingecko:monerium-eur-money'], // EURe legacy
  [addressKey(GBPE_CANONICAL_ADDRESS), 'coingecko:monerium-gbp-emoney'], // GBPe
  [addressKey(GBPE_LEGACY_ADDRESS), 'coingecko:monerium-gbp-emoney'], // GBPe legacy
  [addressKey('0xaBEf652195F98A91E490f047A5006B71c85f058d'), 'xdai:0xaBEf652195F98A91E490f047A5006B71c85f058d'], // crvUSD
  [addressKey('0x4b1E2c2762667331Bc91648052F646d1b0d35984'), 'xdai:0x4b1E2c2762667331Bc91648052F646d1b0d35984'], // EURA
  [addressKey('0x54E4cB2a4Fa0ee46E3d9A98D13Bea119666E09f6'), 'xdai:0x54E4cB2a4Fa0ee46E3d9A98D13Bea119666E09f6'], // EURC.e
  [addressKey('0xFECB3F7c54E2CAAE9dC6Ac9060A822D47E053760'), 'xdai:0xFECB3F7c54E2CAAE9dC6Ac9060A822D47E053760'], // BRLA
  [addressKey('0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f'), 'xdai:0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f'], // OLAS
  [addressKey('0x71850b7E9Ee3f13Ab46d67167341E4bDc905Eef9'), 'xdai:0x71850b7E9Ee3f13Ab46d67167341E4bDc905Eef9'], // HNY
  [addressKey('0xD057604A14982FE8D88c5fC25Aac3267eA142a08'), 'xdai:0xD057604A14982FE8D88c5fC25Aac3267eA142a08'], // HOPR
  [addressKey('0xc791240D1F2dEf5938E2031364Ff4ed887133C3d'), 'coingecko:rocket-pool-eth'], // rETH
])

const PREFER_DEFILLAMA_PRICE_ADDRESSES = new Set<string>([
  addressKey('0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430'), // EURe
  addressKey('0xcB444e90D8198415266c6a2724b7900fb12FC56E'), // EURe legacy
  addressKey(GBPE_CANONICAL_ADDRESS),
  addressKey(GBPE_LEGACY_ADDRESS),
  addressKey('0xaBEf652195F98A91E490f047A5006B71c85f058d'), // crvUSD
  addressKey('0x4b1E2c2762667331Bc91648052F646d1b0d35984'), // EURA
  addressKey('0x54E4cB2a4Fa0ee46E3d9A98D13Bea119666E09f6'), // EURC.e
  addressKey('0xFECB3F7c54E2CAAE9dC6Ac9060A822D47E053760'), // BRLA
  addressKey('0xc791240D1F2dEf5938E2031364Ff4ed887133C3d'), // rETH
])

const DEFILLAMA_PRICE_IDS = [...new Set(DEFILLAMA_PRICE_IDS_BY_ADDRESS.values())]

let cachedOsgnoRate: { value: number; expiresAt: number } | undefined
let cachedDefiLlamaPrices: { values: Map<string, number>; expiresAt: number } | undefined
let pendingDefiLlamaPrices: Promise<Map<string, number>> | undefined

function addressKey(address: string): string {
  try {
    return getAddress(address).toLowerCase()
  } catch {
    return address.toLowerCase()
  }
}

function usablePrice(priceUSD: number | undefined): number | undefined {
  return priceUSD !== undefined && Number.isFinite(priceUSD) && priceUSD > 0 && priceUSD <= MAX_PRICE_USD
    ? priceUSD
    : undefined
}

async function getCachedOsgnoRate(): Promise<number | undefined> {
  const now = Date.now()
  if (cachedOsgnoRate && cachedOsgnoRate.expiresAt > now) {
    return cachedOsgnoRate.value
  }
  const value = await fetchOsgnoRate(client).catch((error) => {
    console.warn('osGNO oracle price unavailable; falling back to indexed osGNO price', error)
    return undefined
  })
  if (value !== undefined) {
    cachedOsgnoRate = { value, expiresAt: now + OSGNO_RATE_CACHE_MS }
  }
  return value
}

async function fetchDefiLlamaPrices(): Promise<Map<string, number>> {
  if (process.env.DEFILLAMA_PRICE_FALLBACKS_DISABLED === 'true' || DEFILLAMA_PRICE_IDS.length === 0) {
    return new Map()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFILLAMA_PRICE_TIMEOUT_MS)
  try {
    const response = await fetch(`${DEFILLAMA_PRICE_API}/${DEFILLAMA_PRICE_IDS.join(',')}?searchWidth=4h`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`DefiLlama prices ${response.status}: ${await response.text()}`)
    }
    const json = (await response.json()) as {
      coins?: Record<string, { price?: number }>
    }
    const values = new Map<string, number>()
    for (const id of DEFILLAMA_PRICE_IDS) {
      const price = usablePrice(json.coins?.[id]?.price)
      if (price !== undefined) {
        values.set(id, price)
      }
    }
    return values
  } finally {
    clearTimeout(timeout)
  }
}

async function getCachedDefiLlamaPrices(): Promise<Map<string, number>> {
  const now = Date.now()
  if (cachedDefiLlamaPrices && cachedDefiLlamaPrices.expiresAt > now) {
    return cachedDefiLlamaPrices.values
  }
  if (!pendingDefiLlamaPrices) {
    pendingDefiLlamaPrices = fetchDefiLlamaPrices()
      .then((values) => {
        cachedDefiLlamaPrices = { values, expiresAt: Date.now() + DEFILLAMA_PRICE_CACHE_MS }
        return values
      })
      .catch((error) => {
        console.warn('DefiLlama price fallback unavailable', error)
        return cachedDefiLlamaPrices?.values ?? new Map<string, number>()
      })
      .finally(() => {
        pendingDefiLlamaPrices = undefined
      })
  }
  return pendingDefiLlamaPrices
}

function getDirectIndexedTokenPriceUSD(address: string): number | undefined {
  return usablePrice(getTokenRow(address)?.priceUSD)
}

function getAliasedIndexedTokenPriceUSD(address: string): number | undefined {
  const alias = ADDRESS_PRICE_ALIASES.get(addressKey(address))
  return alias ? usablePrice(getTokenRow(alias)?.priceUSD) : undefined
}

export function getIndexedTokenPriceUSD(address: string): number | undefined {
  return getDirectIndexedTokenPriceUSD(address) ?? getAliasedIndexedTokenPriceUSD(address)
}

export async function getDefiLlamaTokenPriceUSD(address: string): Promise<number | undefined> {
  const priceId = DEFILLAMA_PRICE_IDS_BY_ADDRESS.get(addressKey(address))
  if (!priceId) {
    return undefined
  }
  return (await getCachedDefiLlamaPrices()).get(priceId)
}

export async function getEffectiveTokenPriceUSD(address: string, indexedPriceUSD?: number): Promise<number | undefined> {
  const directIndexed = usablePrice(indexedPriceUSD) ?? getDirectIndexedTokenPriceUSD(address)
  if (isOsgnoAddress(address)) {
    return deriveOsgnoPriceUsd(getIndexedTokenPriceUSD(GNO_ADDRESS), await getCachedOsgnoRate()) ?? directIndexed
  }
  const defiLlamaPrice = await getDefiLlamaTokenPriceUSD(address)
  const aliasedIndexed = getAliasedIndexedTokenPriceUSD(address)
  if (PREFER_DEFILLAMA_PRICE_ADDRESSES.has(addressKey(address))) {
    return defiLlamaPrice ?? directIndexed ?? aliasedIndexed
  }
  return directIndexed ?? defiLlamaPrice ?? aliasedIndexed
}
