/**
 * HyperSync + RPC backfill for Uniswap V3 on Gnosis (chain 100).
 *
 * Produces the analytics snapshot the adapter serves to the UI's Explore page
 * (top tokens + top pools with TVL and 24h volume). Written this way because
 * Uniswap's data gateway does not cover Gnosis AND envio's codegen is currently
 * a no-op on darwin-arm64 — so we read events from HyperSync (blazing fast) and
 * current state from RPC directly, with no envio runtime in the loop.
 *
 * Data sources (all primary):
 *   - Pool set:        HyperSync PoolCreated logs from the V3 factory
 *   - Token metadata:  RPC multicall (symbol/name/decimals)
 *   - Spot prices:     RPC slot0.sqrtPriceX96 per pool (V3 spot, NOT reserve ratio),
 *                      propagated from USD stables pegged at $1
 *   - TVL:             RPC balanceOf(pool) reserves x USD price
 *   - 24h volume:      HyperSync Swap logs over the last ~24h of blocks
 *
 * Pricing assumption (documented, matches the indexer skeleton): the canonical
 * USD stables on Gnosis are treated as exactly $1; every other token's USD price
 * is derived from its deepest pool against an already-priced token. EUR/GBP pegged
 * tokens therefore inherit a USD price via their pools, not a fiat rate.
 */
import { createPublicClient, http, parseAbi, getAddress } from 'viem'
import { gnosis } from 'viem/chains'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HYPERSYNC_URL = 'https://gnosis.hypersync.xyz/query'
const HEIGHT_URL = 'https://gnosis.hypersync.xyz/height'
const ENVIO_API_TOKEN = process.env.ENVIO_API_TOKEN
const RPC_URL = process.env.RPC_GNOSIS ?? 'https://rpc.gnosischain.com'

const FACTORY = '0xe32f7dd7e3f098d518ff19a22d5f028e076489b1'
const POOL_CREATED_TOPIC = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'
const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
const FACTORY_START_BLOCK = 27145342
const BLOCKS_PER_DAY = 17280 // Gnosis ~5s blocks

// Canonical USD stables on Gnosis (lowercased) — pegged to $1 for derivation.
// Addresses verified on-chain via symbol() this session. sDAI is intentionally
// excluded (yield-bearing, ~$1.1) so it derives a real price from its pools.
const USD_STABLES = new Set<string>([
  '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', // WXDAI
  '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0', // USDC.e
  '0x4ecaba5870353805a9f068101a40e0f32ed605c6', // USDT
  '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', // USDC (native)
  '0x44fa8e6f47987339850636f88629646662444217', // DAI (bridged)
  '0xabef652195f98a91e490f047a5006b71c85f058d', // crvUSD
  '0xca5d8f8a8d49439357d3cf46ca2e720702f132b8', // GYD
])

const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'analytics.json')

const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
])

interface PoolRaw {
  pool: string
  token0: string
  token1: string
  fee: number
}
interface HyperLog {
  address: string
  topic0?: string
  topic1?: string
  topic2?: string
  topic3?: string
  data?: string
  block_number?: number
}

async function hyperQuery(body: unknown): Promise<{ data: { logs?: HyperLog[] }[]; next_block: number; archive_height: number }> {
  if (!ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is required for HyperSync (get one at https://envio.dev/app/api-tokens)')
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(HYPERSYNC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ENVIO_API_TOKEN}` },
      body: JSON.stringify(body),
    })
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`HyperSync ${res.status}: ${await res.text()}`)
    return (await res.json()) as never
  }
  throw new Error('HyperSync: too many 429s')
}

async function hyperHeight(): Promise<number> {
  const res = await fetch(HEIGHT_URL)
  return ((await res.json()) as { height: number }).height
}

/** Scan a topic across a block range, paging until caught up. */
async function scanLogs(addresses: string[], topic0: string, fromBlock: number): Promise<HyperLog[]> {
  const out: HyperLog[] = []
  let from = fromBlock
  for (let page = 0; page < 5000; page++) {
    const r = await hyperQuery({
      from_block: from,
      logs: [{ address: addresses, topics: [[topic0]] }],
      field_selection: { log: ['address', 'topic1', 'topic2', 'topic3', 'data', 'block_number'] },
    })
    for (const b of r.data) for (const lg of b.logs ?? []) out.push(lg)
    if (!r.next_block || r.next_block <= from) break
    from = r.next_block
  }
  return out
}

function int256(hex: string): bigint {
  let v = BigInt(hex)
  if (v >> 255n) v -= 1n << 256n
  return v
}

/** V3 spot price: token1 per token0, human-adjusted for decimals. */
function price1Per0(sqrtP: bigint, dec0: number, dec1: number): number {
  const Q96 = 1n << 96n
  // (sqrtP^2 / 2^192) * 10^dec0 / 10^dec1, scaled by 1e18 for precision
  const scaled = (sqrtP * sqrtP * 10n ** BigInt(dec0) * 10n ** 18n) / (10n ** BigInt(dec1) * Q96 * Q96)
  return Number(scaled) / 1e18
}

async function main(): Promise<void> {
  const client = createPublicClient({ chain: gnosis, transport: http(RPC_URL) })
  const height = await hyperHeight()
  console.log(`HyperSync height ${height}; RPC ${RPC_URL}`)

  // 1) All pools from the factory.
  const created = await scanLogs([FACTORY], POOL_CREATED_TOPIC, FACTORY_START_BLOCK)
  const pools: PoolRaw[] = created.map((lg) => ({
    pool: getAddress('0x' + (lg.data ?? '').slice(2).slice(-40)).toLowerCase(),
    token0: getAddress('0x' + (lg.topic1 ?? '').slice(-40)).toLowerCase(),
    token1: getAddress('0x' + (lg.topic2 ?? '').slice(-40)).toLowerCase(),
    fee: Number(BigInt(lg.topic3 ?? '0x0')),
  }))
  console.log(`pools: ${pools.length}`)

  // 2) Token metadata (symbol/name/decimals) via multicall.
  const tokenSet = [...new Set(pools.flatMap((p) => [p.token0, p.token1]))]
  const metaCalls = tokenSet.flatMap((addr) => [
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'symbol' as const },
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'name' as const },
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'decimals' as const },
  ])
  const metaRes = await client.multicall({ contracts: metaCalls, allowFailure: true })
  const meta = new Map<string, { symbol: string; name: string; decimals: number }>()
  tokenSet.forEach((addr, i) => {
    const s = metaRes[i * 3]
    const n = metaRes[i * 3 + 1]
    const d = metaRes[i * 3 + 2]
    meta.set(addr, {
      symbol: s.status === 'success' ? (s.result as string) : addr.slice(0, 8),
      name: n.status === 'success' ? (n.result as string) : addr.slice(0, 8),
      decimals: d.status === 'success' ? Number(d.result) : 18,
    })
  })

  // 3) Pool state: slot0 (spot price) + reserves (balanceOf token0/token1).
  const stateCalls = pools.flatMap((p) => [
    { address: p.pool as `0x${string}`, abi: poolAbi, functionName: 'slot0' as const },
    { address: p.token0 as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [p.pool as `0x${string}`] },
    { address: p.token1 as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [p.pool as `0x${string}`] },
  ])
  const stateRes = await client.multicall({ contracts: stateCalls, allowFailure: true })

  interface PoolState extends PoolRaw {
    sqrtP: bigint
    price1per0: number // token1 per token0
    reserve0: number // human
    reserve1: number
  }
  const poolStates: PoolState[] = pools.map((p, i) => {
    const slot0 = stateRes[i * 3]
    const bal0 = stateRes[i * 3 + 1]
    const bal1 = stateRes[i * 3 + 2]
    const d0 = meta.get(p.token0)!.decimals
    const d1 = meta.get(p.token1)!.decimals
    const sqrtP = slot0.status === 'success' ? (slot0.result as unknown as bigint[])[0] : 0n
    const r0 = bal0.status === 'success' ? Number(bal0.result as bigint) / 10 ** d0 : 0
    const r1 = bal1.status === 'success' ? Number(bal1.result as bigint) / 10 ** d1 : 0
    return { ...p, sqrtP, price1per0: sqrtP > 0n ? price1Per0(sqrtP, d0, d1) : 0, reserve0: r0, reserve1: r1 }
  })

  // 4) USD prices: seed stables at $1, propagate along pools by deepest liquidity.
  // Guard against junk/scam tokens (e.g. dust pools with extreme sqrtPrice): no real
  // ERC20 has a unit price above ~$1M (WBTC, the priciest here, is ~$60k), so any
  // derived price above the ceiling is rejected and the token stays unpriced — its
  // illiquid pool then contributes ~$0 TVL and drops out of the rankings naturally.
  const MAX_PRICE_USD = 1_000_000
  const accept = (v: number): boolean => Number.isFinite(v) && v > 0 && v <= MAX_PRICE_USD
  const priceUSD = new Map<string, number>()
  for (const t of tokenSet) if (USD_STABLES.has(t)) priceUSD.set(t, 1)
  for (let round = 0; round < 6; round++) {
    // sort pools by current best-known TVL so we propagate from the deepest first
    const ranked = [...poolStates].sort((a, b) => poolDepth(b) - poolDepth(a))
    let changed = false
    for (const p of ranked) {
      if (p.price1per0 <= 0) continue
      const p0 = priceUSD.get(p.token0)
      const p1 = priceUSD.get(p.token1)
      if (p0 != null && p1 == null) {
        // 1 token0 = price1per0 token1  => P1 = P0 / price1per0
        const cand = p0 / p.price1per0
        if (accept(cand)) {
          priceUSD.set(p.token1, cand)
          changed = true
        }
      } else if (p1 != null && p0 == null) {
        const cand = p1 * p.price1per0
        if (accept(cand)) {
          priceUSD.set(p.token0, cand)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  function poolDepth(p: PoolState): number {
    const v0 = (priceUSD.get(p.token0) ?? 0) * p.reserve0
    const v1 = (priceUSD.get(p.token1) ?? 0) * p.reserve1
    return v0 + v1
  }

  // 5) 24h swap volume per pool from HyperSync.
  const poolAddrs = poolStates.map((p) => p.pool)
  const swaps = await scanLogs(poolAddrs, SWAP_TOPIC, Math.max(FACTORY_START_BLOCK, height - BLOCKS_PER_DAY))
  console.log(`24h swaps: ${swaps.length}`)
  const vol24 = new Map<string, number>()
  const tx24 = new Map<string, number>()
  const byAddr = new Map(poolStates.map((p) => [p.pool, p]))
  for (const s of swaps) {
    const addr = s.address.toLowerCase()
    const p = byAddr.get(addr)
    if (!p) continue
    tx24.set(addr, (tx24.get(addr) ?? 0) + 1)
    const d0 = meta.get(p.token0)!.decimals
    const d1 = meta.get(p.token1)!.decimals
    const raw = (s.data ?? '0x').slice(2)
    const a0 = Math.abs(Number(int256('0x' + raw.slice(0, 64)))) / 10 ** d0
    const a1 = Math.abs(Number(int256('0x' + raw.slice(64, 128)))) / 10 ** d1
    const pr0 = priceUSD.get(p.token0)
    const pr1 = priceUSD.get(p.token1)
    const usd = pr0 != null ? a0 * pr0 : pr1 != null ? a1 * pr1 : 0
    vol24.set(addr, (vol24.get(addr) ?? 0) + usd)
  }

  // 6) Assemble pool + token rows.
  const poolRows = poolStates.map((p) => {
    const tvl = poolDepth(p)
    return {
      id: p.pool,
      feeTier: p.fee,
      totalValueLockedUSD: tvl,
      volumeUSD: vol24.get(p.pool) ?? 0,
      feesUSD: (vol24.get(p.pool) ?? 0) * (p.fee / 1e6),
      txCount: tx24.get(p.pool) ?? 0,
      token0: tokenRow(p.token0),
      token1: tokenRow(p.token1),
    }
  })
  function tokenRow(addr: string) {
    const m = meta.get(addr)!
    return {
      id: addr,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      totalValueLockedUSD: 0,
      volumeUSD: 0,
      txCount: 0,
      derivedXDAI: priceUSD.get(addr) ?? 0,
    }
  }
  // token-level aggregates from pool rows
  const tokenAgg = new Map<string, { tvl: number; vol: number; tx: number }>()
  for (const p of poolStates) {
    const a = tokenAgg.get(p.token0) ?? { tvl: 0, vol: 0, tx: 0 }
    a.tvl += (priceUSD.get(p.token0) ?? 0) * p.reserve0
    a.vol += vol24.get(p.pool) ?? 0
    a.tx += tx24.get(p.pool) ?? 0
    tokenAgg.set(p.token0, a)
    const b = tokenAgg.get(p.token1) ?? { tvl: 0, vol: 0, tx: 0 }
    b.tvl += (priceUSD.get(p.token1) ?? 0) * p.reserve1
    b.vol += vol24.get(p.pool) ?? 0
    b.tx += tx24.get(p.pool) ?? 0
    tokenAgg.set(p.token1, b)
  }
  const tokenRows = tokenSet.map((addr) => {
    const m = meta.get(addr)!
    const a = tokenAgg.get(addr) ?? { tvl: 0, vol: 0, tx: 0 }
    return {
      id: addr,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      totalValueLockedUSD: a.tvl,
      volumeUSD: a.vol,
      txCount: a.tx,
      derivedXDAI: priceUSD.get(addr) ?? 0,
    }
  })

  poolRows.sort((a, b) => b.totalValueLockedUSD - a.totalValueLockedUSD)
  tokenRows.sort((a, b) => b.totalValueLockedUSD - a.totalValueLockedUSD)

  const protocol = {
    id: 'gnosis',
    totalValueLockedUSD: poolRows.reduce((s, p) => s + p.totalValueLockedUSD, 0),
    volumeUSD: poolRows.reduce((s, p) => s + p.volumeUSD, 0),
    txCount: poolRows.reduce((s, p) => s + p.txCount, 0),
    poolCount: poolRows.length,
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify({ updatedAtBlock: height, tokens: tokenRows, pools: poolRows, protocol }, null, 2))
  console.log(`\nwrote ${OUT_PATH}`)
  console.log(`protocol TVL=$${protocol.totalValueLockedUSD.toFixed(0)} 24hVol=$${protocol.volumeUSD.toFixed(0)} pools=${protocol.poolCount} tx24=${protocol.txCount}`)
  console.log('\nTop 10 pools by TVL:')
  for (const p of poolRows.slice(0, 10)) {
    console.log(
      `  ${p.token0.symbol}/${p.token1.symbol} ${p.feeTier} TVL=$${p.totalValueLockedUSD.toFixed(0)} vol24=$${p.volumeUSD.toFixed(0)}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
