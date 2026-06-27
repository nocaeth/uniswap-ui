/**
 * Historical indexer for Uniswap V3 on Gnosis (chain 100) → SQLite.
 *
 * Replaces the original shallow JSON snapshot with a real rollup store
 * (`data/analytics.db`, see db.ts). Uniswap's data gateway has no Gnosis and
 * envio's codegen is a no-op on darwin-arm64, so we read events from HyperSync
 * (fast) and current state from RPC directly, then compute the rollups the UI
 * needs.
 *
 * What it builds:
 *   - pools / tokens        current snapshot (RPC slot0 + balanceOf + multicall meta)
 *   - token_day_data        per-token daily price + volume + tvl series
 *   - token_hour_data       per-token hourly price + volume (recent window)
 *   - pool_day_data         per-pool daily volume/tvl/fees/prices
 *   - pool_hour_data*       (volume only; via token_hour_data — pools share window)
 *   - protocol_day_data     daily protocol TVL + volume series (V3 only on Gnosis)
 *   - transactions          recent swap/mint/burn feed (USD + account + timestamp)
 *
 * Pricing (unchanged from the proven approach): V3 spot from sqrtPriceX96, USD
 * stables pegged at $1, propagated to other tokens along the deepest pool, and
 * any derived unit price above $1M is rejected as junk. Daily/hourly prices use
 * the last swap's sqrtPriceX96 in each bucket (carried forward); the current
 * bucket is pinned to RPC slot0. Daily reserves are reconstructed by walking the
 * RPC balances backward through Mint/Burn/Swap deltas.
 *
 * Windowing: full history is large (V3 Gnosis does ~30k swap/mint/burn per day),
 * so the indexed depth is bounded by env and defaults to a recent window:
 *   INDEX_DAYS   daily series + volume window (default 30; 0 = from factory)
 *   HOURLY_DAYS  hourly series window (default min(INDEX_DAYS, 30))
 *   TX_DAYS      transactions-feed window (default 7)
 *   INDEX_FROM_BLOCK / FACTORY_START_BLOCK override the scan start.
 */
import { createPublicClient, http, parseAbi, getAddress } from 'viem'
import { gnosis } from 'viem/chains'
import { pathToFileURL } from 'node:url'
import { getDb, initSchema } from './db.js'

const HYPERSYNC_URL = 'https://gnosis.hypersync.xyz/query'
const HEIGHT_URL = 'https://gnosis.hypersync.xyz/height'
const ENVIO_API_TOKEN = process.env.ENVIO_API_TOKEN
const RPC_URL = process.env.RPC_GNOSIS ?? 'https://rpc.gnosischain.com'

const FACTORY = '0xe32f7dd7e3f098d518ff19a22d5f028e076489b1'
const POOL_CREATED_TOPIC = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'
const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
const MINT_TOPIC = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde'
const BURN_TOPIC = '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c'
const FACTORY_START_BLOCK = Number(process.env.FACTORY_START_BLOCK ?? 27145342)
const BLOCKS_PER_DAY = 17280 // Gnosis ~5s blocks

const DAY = 86400
const HOUR = 3600
const INDEX_DAYS = Number(process.env.INDEX_DAYS ?? 30)
const HOURLY_DAYS = Number(process.env.HOURLY_DAYS ?? Math.min(INDEX_DAYS || 9999, 30))
const TX_DAYS = Number(process.env.TX_DAYS ?? 7)

// Canonical USD stables on Gnosis (lowercased) — pegged to $1 for derivation.
const USD_STABLES = new Set<string>([
  '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', // WXDAI
  '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0', // USDC.e
  '0x4ecaba5870353805a9f068101a40e0f32ed605c6', // USDT
  '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', // USDC (native)
  '0x44fa8e6f47987339850636f88629646662444217', // DAI (bridged)
  '0xabef652195f98a91e490f047a5006b71c85f058d', // crvUSD
  '0xca5d8f8a8d49439357d3cf46ca2e720702f132b8', // GYD
])

const MAX_PRICE_USD = 1_000_000

const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
])

interface HyperLog {
  address: string
  topic0?: string
  topic1?: string
  topic2?: string
  topic3?: string
  data?: string
  block_number?: number
  transaction_hash?: string
  log_index?: number
}
interface HyperBlock {
  number: number
  timestamp: string
}
interface HyperTx {
  hash: string
  from: string
}
interface HyperChunk {
  logs?: HyperLog[]
  blocks?: HyperBlock[]
  transactions?: HyperTx[]
}
interface HyperResponse {
  data: HyperChunk[]
  next_block: number
  archive_height: number
}

async function hyperQuery(body: unknown): Promise<HyperResponse> {
  if (!ENVIO_API_TOKEN) {
    throw new Error('ENVIO_API_TOKEN is required for HyperSync (https://envio.dev/app/api-tokens)')
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(HYPERSYNC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ENVIO_API_TOKEN}` },
      body: JSON.stringify(body),
    })
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    if (!res.ok) {
      throw new Error(`HyperSync ${res.status}: ${await res.text()}`)
    }
    return (await res.json()) as HyperResponse
  }
  throw new Error('HyperSync: too many 429s')
}

async function hyperHeight(): Promise<number> {
  const res = await fetch(HEIGHT_URL)
  return ((await res.json()) as { height: number }).height
}

function int256(hex: string): bigint {
  let v = BigInt(hex)
  if (v >> 255n) {
    v -= 1n << 256n
  }
  return v
}
const uint = (hex: string): bigint => BigInt(hex)

/** V3 spot price: token1 per token0, human-adjusted for decimals. */
function price1Per0(sqrtP: bigint, dec0: number, dec1: number): number {
  const Q96 = 1n << 96n
  const scaled = (sqrtP * sqrtP * 10n ** BigInt(dec0) * 10n ** 18n) / (10n ** BigInt(dec1) * Q96 * Q96)
  return Number(scaled) / 1e18
}

const floorDay = (ts: number): number => Math.floor(ts / DAY) * DAY
const floorHour = (ts: number): number => Math.floor(ts / HOUR) * HOUR

interface Pool {
  pool: string
  token0: string
  token1: string
  fee: number
  createdBlock: number
}
interface TokenMeta {
  symbol: string
  name: string
  decimals: number
  totalSupply: bigint
  logo: string
}

/** Per-pool accumulators built from the event scan. */
interface PoolAgg {
  // day -> last sqrtPriceX96 in that day (by max ordering key)
  dayLastSqrt: Map<number, { sqrt: bigint; key: number }>
  // day -> summed absolute human swap amounts (token0/token1) + tx count
  dayAmt0: Map<number, number>
  dayAmt1: Map<number, number>
  dayTx: Map<number, number>
  // day -> signed human reserve deltas (Mint +, Burn -, Swap net)
  dayDelta0: Map<number, number>
  dayDelta1: Map<number, number>
  // hour -> last sqrt + amounts (recent window only)
  hourLastSqrt: Map<number, { sqrt: bigint; key: number }>
  hourAmt0: Map<number, number>
  hourAmt1: Map<number, number>
}
function newPoolAgg(): PoolAgg {
  return {
    dayLastSqrt: new Map(),
    dayAmt0: new Map(),
    dayAmt1: new Map(),
    dayTx: new Map(),
    dayDelta0: new Map(),
    dayDelta1: new Map(),
    hourLastSqrt: new Map(),
    hourAmt0: new Map(),
    hourAmt1: new Map(),
  }
}
const addMap = (m: Map<number, number>, k: number, v: number): void => {
  m.set(k, (m.get(k) ?? 0) + v)
}
const setLast = (m: Map<number, { sqrt: bigint; key: number }>, k: number, sqrt: bigint, key: number): void => {
  const cur = m.get(k)
  if (!cur || key >= cur.key) {
    m.set(k, { sqrt, key })
  }
}

interface RawTx {
  hash: string
  logIndex: number
  type: 'SWAP' | 'ADD' | 'REMOVE'
  poolId: string
  token0: string
  token1: string
  amount0: number // signed human, pool perspective
  amount1: number
  account: string
  timestamp: number
  blockNumber: number
}

export async function runBackfill(): Promise<void> {
  const t0 = Date.now()
  const client = createPublicClient({ chain: gnosis, transport: http(RPC_URL) })
  const height = await hyperHeight()
  const nowTs = Math.floor(Date.now() / 1000)
  const windowFromBlock =
    process.env.INDEX_FROM_BLOCK != null
      ? Number(process.env.INDEX_FROM_BLOCK)
      : INDEX_DAYS > 0
        ? Math.max(FACTORY_START_BLOCK, height - INDEX_DAYS * BLOCKS_PER_DAY)
        : FACTORY_START_BLOCK
  const hourlyFromTs = nowTs - HOURLY_DAYS * DAY
  const txFromTs = nowTs - TX_DAYS * DAY
  console.log(
    `HyperSync height ${height}; RPC ${RPC_URL}\nindex window: blocks ${windowFromBlock}..${height} (~${INDEX_DAYS || 'all'}d), hourly ${HOURLY_DAYS}d, tx feed ${TX_DAYS}d`,
  )

  // 1) All pools from the factory (full history — cheap).
  const pools: Pool[] = []
  for (let from = FACTORY_START_BLOCK; ; ) {
    const r = await hyperQuery({
      from_block: from,
      logs: [{ address: [FACTORY], topics: [[POOL_CREATED_TOPIC]] }],
      field_selection: { log: ['topic1', 'topic2', 'topic3', 'data', 'block_number'] },
    })
    for (const c of r.data) {
      for (const lg of c.logs ?? []) {
        pools.push({
          pool: getAddress('0x' + (lg.data ?? '').slice(2).slice(-40)).toLowerCase(),
          token0: getAddress('0x' + (lg.topic1 ?? '').slice(-40)).toLowerCase(),
          token1: getAddress('0x' + (lg.topic2 ?? '').slice(-40)).toLowerCase(),
          fee: Number(BigInt(lg.topic3 ?? '0x0')),
          createdBlock: lg.block_number ?? 0,
        })
      }
    }
    if (!r.next_block || r.next_block <= from) {
      break
    }
    from = r.next_block
  }
  const poolById = new Map(pools.map((p) => [p.pool, p]))
  const poolAddrs = pools.map((p) => p.pool)
  console.log(`pools: ${pools.length}`)

  // 2) Token metadata (symbol/name/decimals/totalSupply) + logos.
  const tokenSet = [...new Set(pools.flatMap((p) => [p.token0, p.token1]))]
  const metaCalls = tokenSet.flatMap((addr) => [
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'symbol' as const },
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'name' as const },
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'decimals' as const },
    { address: addr as `0x${string}`, abi: erc20Abi, functionName: 'totalSupply' as const },
  ])
  const metaRes = await client.multicall({ contracts: metaCalls, allowFailure: true })
  const logos = await fetchLogos()
  const meta = new Map<string, TokenMeta>()
  tokenSet.forEach((addr, i) => {
    const s = metaRes[i * 4]
    const n = metaRes[i * 4 + 1]
    const d = metaRes[i * 4 + 2]
    const ts = metaRes[i * 4 + 3]
    meta.set(addr, {
      symbol: s.status === 'success' ? (s.result as string) : addr.slice(0, 8),
      name: n.status === 'success' ? (n.result as string) : addr.slice(0, 8),
      decimals: d.status === 'success' ? Number(d.result) : 18,
      totalSupply: ts.status === 'success' ? (ts.result as bigint) : 0n,
      logo: logos.get(addr) ?? '',
    })
  })
  const dec = (addr: string): number => meta.get(addr)?.decimals ?? 18

  // 3) Current pool state: slot0 (spot) + reserves (balanceOf token0/token1).
  const stateCalls = pools.flatMap((p) => [
    { address: p.pool as `0x${string}`, abi: poolAbi, functionName: 'slot0' as const },
    { address: p.token0 as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [p.pool as `0x${string}`] },
    { address: p.token1 as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [p.pool as `0x${string}`] },
  ])
  const stateRes = await client.multicall({ contracts: stateCalls, allowFailure: true })
  interface PoolState {
    sqrt: bigint
    reserve0: number
    reserve1: number
  }
  const nowState = new Map<string, PoolState>()
  pools.forEach((p, i) => {
    const slot0 = stateRes[i * 3]
    const bal0 = stateRes[i * 3 + 1]
    const bal1 = stateRes[i * 3 + 2]
    const sqrt = slot0.status === 'success' ? (slot0.result as unknown as bigint[])[0] : 0n
    const r0 = bal0.status === 'success' ? Number(bal0.result as bigint) / 10 ** dec(p.token0) : 0
    const r1 = bal1.status === 'success' ? Number(bal1.result as bigint) / 10 ** dec(p.token1) : 0
    nowState.set(p.pool, { sqrt, reserve0: r0, reserve1: r1 })
  })

  // 4) Scan Swap/Mint/Burn across all pools in the window, accumulating rollups.
  const agg = new Map<string, PoolAgg>()
  for (const p of poolAddrs) {
    agg.set(p, newPoolAgg())
  }
  const recentTx: RawTx[] = []
  let eventCount = 0
  for (let from = windowFromBlock; ; ) {
    const r = await hyperQuery({
      from_block: from,
      logs: [{ address: poolAddrs, topics: [[SWAP_TOPIC, MINT_TOPIC, BURN_TOPIC]] }],
      field_selection: {
        log: ['address', 'topic0', 'data', 'block_number', 'transaction_hash', 'log_index'],
        block: ['number', 'timestamp'],
        transaction: ['hash', 'from'],
      },
    })
    for (const c of r.data) {
      const blockTs = new Map<number, number>()
      for (const b of c.blocks ?? []) {
        blockTs.set(b.number, parseInt(b.timestamp, 16))
      }
      const txFrom = new Map<string, string>()
      for (const t of c.transactions ?? []) {
        txFrom.set(t.hash, t.from)
      }
      for (const lg of c.logs ?? []) {
        const poolAddr = lg.address.toLowerCase()
        const p = poolById.get(poolAddr)
        if (!p) {
          continue
        }
        const a = agg.get(poolAddr)!
        const bn = lg.block_number ?? 0
        const ts = blockTs.get(bn) ?? nowTs
        const day = floorDay(ts)
        const hour = floorHour(ts)
        const orderKey = bn * 1e6 + (lg.log_index ?? 0)
        const raw = (lg.data ?? '0x').slice(2)
        const d0 = dec(p.token0)
        const d1 = dec(p.token1)
        eventCount++

        if (lg.topic0 === SWAP_TOPIC) {
          const amt0 = Number(int256('0x' + raw.slice(0, 64))) / 10 ** d0
          const amt1 = Number(int256('0x' + raw.slice(64, 128))) / 10 ** d1
          const sqrt = uint('0x' + raw.slice(128, 192))
          setLast(a.dayLastSqrt, day, sqrt, orderKey)
          addMap(a.dayAmt0, day, Math.abs(amt0))
          addMap(a.dayAmt1, day, Math.abs(amt1))
          addMap(a.dayTx, day, 1)
          addMap(a.dayDelta0, day, amt0)
          addMap(a.dayDelta1, day, amt1)
          if (ts >= hourlyFromTs) {
            setLast(a.hourLastSqrt, hour, sqrt, orderKey)
            addMap(a.hourAmt0, hour, Math.abs(amt0))
            addMap(a.hourAmt1, hour, Math.abs(amt1))
          }
          if (ts >= txFromTs) {
            recentTx.push({
              hash: lg.transaction_hash ?? '',
              logIndex: lg.log_index ?? 0,
              type: 'SWAP',
              poolId: poolAddr,
              token0: p.token0,
              token1: p.token1,
              amount0: amt0,
              amount1: amt1,
              account: txFrom.get(lg.transaction_hash ?? '') ?? '',
              timestamp: ts,
              blockNumber: bn,
            })
          }
        } else if (lg.topic0 === MINT_TOPIC) {
          const amt0 = Number(uint('0x' + raw.slice(128, 192))) / 10 ** d0
          const amt1 = Number(uint('0x' + raw.slice(192, 256))) / 10 ** d1
          addMap(a.dayDelta0, day, amt0)
          addMap(a.dayDelta1, day, amt1)
          if (ts >= txFromTs) {
            recentTx.push({
              hash: lg.transaction_hash ?? '',
              logIndex: lg.log_index ?? 0,
              type: 'ADD',
              poolId: poolAddr,
              token0: p.token0,
              token1: p.token1,
              amount0: amt0,
              amount1: amt1,
              account: txFrom.get(lg.transaction_hash ?? '') ?? '',
              timestamp: ts,
              blockNumber: bn,
            })
          }
        } else if (lg.topic0 === BURN_TOPIC) {
          const amt0 = Number(uint('0x' + raw.slice(64, 128))) / 10 ** d0
          const amt1 = Number(uint('0x' + raw.slice(128, 192))) / 10 ** d1
          addMap(a.dayDelta0, day, -amt0)
          addMap(a.dayDelta1, day, -amt1)
          if (ts >= txFromTs) {
            recentTx.push({
              hash: lg.transaction_hash ?? '',
              logIndex: lg.log_index ?? 0,
              type: 'REMOVE',
              poolId: poolAddr,
              token0: p.token0,
              token1: p.token1,
              amount0: -amt0,
              amount1: -amt1,
              account: txFrom.get(lg.transaction_hash ?? '') ?? '',
              timestamp: ts,
              blockNumber: bn,
            })
          }
        }
      }
    }
    if (!r.next_block || r.next_block <= from || r.next_block > height) {
      break
    }
    from = r.next_block
  }
  console.log(`events scanned: ${eventCount}; recent tx (${TX_DAYS}d): ${recentTx.length}; elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  // 5) Build the day + hour axes.
  const todayDay = floorDay(nowTs)
  const nowHour = floorHour(nowTs)
  const firstDay = INDEX_DAYS > 0 ? todayDay - (INDEX_DAYS - 1) * DAY : todayDay - 365 * DAY
  const days: number[] = []
  for (let d = firstDay; d <= todayDay; d += DAY) {
    days.push(d)
  }
  const firstHour = floorHour(hourlyFromTs)
  const hours: number[] = []
  for (let h = firstHour; h <= nowHour; h += HOUR) {
    hours.push(h)
  }

  // 6) Per-pool daily reserves (walk RPC balances backward) + carried-forward spot.
  interface PoolDaily {
    reserve0: number[]
    reserve1: number[]
    price1per0: number[] // token1 per token0
  }
  const poolDaily = new Map<string, PoolDaily>()
  for (const p of pools) {
    const a = agg.get(p.pool)!
    const st = nowState.get(p.pool)!
    // reserves backward from current RPC balances
    const reserve0 = new Array<number>(days.length)
    const reserve1 = new Array<number>(days.length)
    let cur0 = st.reserve0
    let cur1 = st.reserve1
    reserve0[days.length - 1] = cur0
    reserve1[days.length - 1] = cur1
    for (let i = days.length - 1; i >= 1; i--) {
      cur0 -= a.dayDelta0.get(days[i]) ?? 0
      cur1 -= a.dayDelta1.get(days[i]) ?? 0
      reserve0[i - 1] = cur0
      reserve1[i - 1] = cur1
    }
    // daily spot: last swap sqrt in bucket, carried forward; pin today to RPC slot0
    const d0 = dec(p.token0)
    const d1 = dec(p.token1)
    const price1per0 = new Array<number>(days.length).fill(0)
    let carry = 0
    for (let i = 0; i < days.length; i++) {
      const last = a.dayLastSqrt.get(days[i])
      if (last && last.sqrt > 0n) {
        carry = price1Per0(last.sqrt, d0, d1)
      }
      price1per0[i] = carry
    }
    // back-fill leading zeros with first known (or RPC slot0)
    const firstKnown = price1per0.find((v) => v > 0) ?? (st.sqrt > 0n ? price1Per0(st.sqrt, d0, d1) : 0)
    for (let i = 0; i < days.length; i++) {
      if (price1per0[i] <= 0) {
        price1per0[i] = firstKnown
      }
    }
    if (st.sqrt > 0n) {
      price1per0[days.length - 1] = price1Per0(st.sqrt, d0, d1)
    }
    poolDaily.set(p.pool, { reserve0, reserve1, price1per0 })
  }

  // 7) Daily USD propagation → token_day_data / pool_day_data / protocol_day_data.
  const db = getDb(true)
  initSchema(db)
  db.exec(
    'DELETE FROM tokens; DELETE FROM pools; DELETE FROM token_day_data; DELETE FROM token_hour_data; DELETE FROM pool_day_data; DELETE FROM protocol_day_data; DELETE FROM transactions; DELETE FROM meta;',
  )

  const insTokenDay = db.prepare('INSERT OR REPLACE INTO token_day_data (tokenId,day,priceUSD,volumeUSD,tvlUSD) VALUES (?,?,?,?,?)')
  const insPoolDay = db.prepare(
    'INSERT OR REPLACE INTO pool_day_data (poolId,day,volumeUSD,tvlUSD,feesUSD,token0Price,token1Price,txCount) VALUES (?,?,?,?,?,?,?,?)',
  )
  const insProtoDay = db.prepare('INSERT OR REPLACE INTO protocol_day_data (day,tvlUSD,volumeUSD) VALUES (?,?,?)')
  const insTokenHour = db.prepare('INSERT OR REPLACE INTO token_hour_data (tokenId,hour,priceUSD,volumeUSD) VALUES (?,?,?,?)')

  // keep day-price per token for the tx USD pass + percent-change snapshot
  const tokenDayPrice = new Map<string, Map<number, number>>()
  for (const t of tokenSet) {
    tokenDayPrice.set(t, new Map())
  }
  const tokenDayVol = new Map<string, Map<number, number>>()
  for (const t of tokenSet) {
    tokenDayVol.set(t, new Map())
  }

  const writeDays = db.transaction(() => {
    for (let i = 0; i < days.length; i++) {
      const day = days[i]
      const price1per0 = new Map<string, number>()
      for (const p of pools) {
        price1per0.set(p.pool, poolDaily.get(p.pool)!.price1per0[i])
      }
      const depth = (poolId: string, usd: Map<string, number>): number => {
        const pd = poolDaily.get(poolId)!
        const p = poolById.get(poolId)!
        return (usd.get(p.token0) ?? 0) * Math.max(0, pd.reserve0[i]) + (usd.get(p.token1) ?? 0) * Math.max(0, pd.reserve1[i])
      }
      const usd = propagateUSD(pools, price1per0, depth)

      const tokenTvl = new Map<string, number>()
      const tokenVol = new Map<string, number>()
      let protoTvl = 0
      let protoVol = 0
      for (const p of pools) {
        const pd = poolDaily.get(p.pool)!
        const a = agg.get(p.pool)!
        const p0 = usd.get(p.token0)
        const p1 = usd.get(p.token1)
        const r0 = Math.max(0, pd.reserve0[i])
        const r1 = Math.max(0, pd.reserve1[i])
        const tvl = (p0 ?? 0) * r0 + (p1 ?? 0) * r1
        const amt0 = a.dayAmt0.get(day) ?? 0
        const amt1 = a.dayAmt1.get(day) ?? 0
        const vol = p0 != null ? amt0 * p0 : p1 != null ? amt1 * p1 : 0
        const spot = pd.price1per0[i]
        insPoolDay.run(p.pool, day, vol, tvl, vol * (p.fee / 1e6), spot, spot > 0 ? 1 / spot : 0, a.dayTx.get(day) ?? 0)
        protoTvl += tvl
        protoVol += vol
        addMap2(tokenTvl, p.token0, (p0 ?? 0) * r0)
        addMap2(tokenTvl, p.token1, (p1 ?? 0) * r1)
        addMap2(tokenVol, p.token0, vol)
        addMap2(tokenVol, p.token1, vol)
      }
      for (const t of tokenSet) {
        const price = usd.get(t) ?? 0
        const vol = tokenVol.get(t) ?? 0
        insTokenDay.run(t, day, price, vol, tokenTvl.get(t) ?? 0)
        tokenDayPrice.get(t)!.set(day, price)
        tokenDayVol.get(t)!.set(day, vol)
      }
      insProtoDay.run(day, protoTvl, protoVol)
    }
  })
  writeDays()

  // 8) Hourly USD propagation (price + volume only; depth from that hour's day).
  const dayIndex = new Map<number, number>()
  days.forEach((d, i) => dayIndex.set(d, i))
  const tokenHourPrice = new Map<string, Map<number, number>>()
  const tokenHourVol = new Map<string, Map<number, number>>()
  for (const t of tokenSet) {
    tokenHourPrice.set(t, new Map())
    tokenHourVol.set(t, new Map())
  }
  const writeHours = db.transaction(() => {
    // carry-forward hourly spot per pool
    const carry = new Map<string, number>()
    for (const h of hours) {
      const di = dayIndex.get(floorDay(h)) ?? days.length - 1
      const price1per0 = new Map<string, number>()
      for (const p of pools) {
        const last = agg.get(p.pool)!.hourLastSqrt.get(h)
        if (last && last.sqrt > 0n) {
          carry.set(p.pool, price1Per0(last.sqrt, dec(p.token0), dec(p.token1)))
        }
        let v = carry.get(p.pool)
        if (v == null || v <= 0) {
          v = poolDaily.get(p.pool)!.price1per0[Math.max(0, di)]
        }
        price1per0.set(p.pool, v ?? 0)
      }
      // USD-weighted depth (same ordering as the daily pass) so prices propagate
      // from the deepest priced pool first — token-denominated depth mis-orders
      // pools and can yield bogus tiny prices.
      const di2 = Math.max(0, di)
      const depth = (poolId: string, usd: Map<string, number>): number => {
        const pd = poolDaily.get(poolId)!
        const p = poolById.get(poolId)!
        return (usd.get(p.token0) ?? 0) * Math.max(0, pd.reserve0[di2]) + (usd.get(p.token1) ?? 0) * Math.max(0, pd.reserve1[di2])
      }
      const usd = propagateUSD(pools, price1per0, depth)
      const tokenVol = new Map<string, number>()
      for (const p of pools) {
        const a = agg.get(p.pool)!
        const p0 = usd.get(p.token0)
        const p1 = usd.get(p.token1)
        const amt0 = a.hourAmt0.get(h) ?? 0
        const amt1 = a.hourAmt1.get(h) ?? 0
        const vol = p0 != null ? amt0 * p0 : p1 != null ? amt1 * p1 : 0
        addMap2(tokenVol, p.token0, vol)
        addMap2(tokenVol, p.token1, vol)
      }
      for (const t of tokenSet) {
        const price = usd.get(t) ?? 0
        const vol = tokenVol.get(t) ?? 0
        insTokenHour.run(t, h, price, vol)
        tokenHourPrice.get(t)!.set(h, price)
        tokenHourVol.get(t)!.set(h, vol)
      }
    }
  })
  writeHours()

  // 9) Current snapshot prices (RPC slot0) for the tables.
  const curPrice1per0 = new Map<string, number>()
  for (const p of pools) {
    const st = nowState.get(p.pool)!
    curPrice1per0.set(p.pool, st.sqrt > 0n ? price1Per0(st.sqrt, dec(p.token0), dec(p.token1)) : 0)
  }
  const curUSD = propagateUSD(pools, curPrice1per0, (poolId, usd) => {
    const st = nowState.get(poolId)!
    const p = poolById.get(poolId)!
    return (usd.get(p.token0) ?? 0) * st.reserve0 + (usd.get(p.token1) ?? 0) * st.reserve1
  })

  // 10) Token + pool snapshot rows (with trailing volumes + percent changes).
  const sumHour = (m: Map<number, number>, fromTs: number): number => {
    let s = 0
    for (const [h, v] of m) {
      if (h >= fromTs) {
        s += v
      }
    }
    return s
  }
  const sumDay = (m: Map<number, number>, fromTs: number): number => {
    let s = 0
    for (const [d, v] of m) {
      if (d >= fromTs) {
        s += v
      }
    }
    return s
  }
  const priceAt = (hourMap: Map<number, number>, dayMap: Map<number, number>, atTs: number, hourly: boolean): number => {
    const m = hourly ? hourMap : dayMap
    const step = hourly ? HOUR : DAY
    const key = hourly ? floorHour(atTs) : floorDay(atTs)
    for (let k = key; k >= key - 60 * step; k -= step) {
      const v = m.get(k)
      if (v != null && v > 0) {
        return v
      }
    }
    return 0
  }
  const pct = (now: number, then: number): number => {
    if (!(then > 0)) {
      return 0
    }
    const v = ((now - then) / then) * 100
    // guard against data anomalies (e.g. a momentarily mis-propagated reference price)
    return Number.isFinite(v) && Math.abs(v) < 1e6 ? v : 0
  }

  const insToken = db.prepare(
    `INSERT OR REPLACE INTO tokens
     (id,symbol,name,decimals,totalSupply,logo,priceUSD,tvlUSD,fdv,
      volume1h,volume1d,volume7d,volume30d,volume1y,
      priceChange1h,priceChange1d,priceChange1w,priceChange1m,priceChange1y)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  // current token tvl across pools
  const curTokenTvl = new Map<string, number>()
  for (const p of pools) {
    const st = nowState.get(p.pool)!
    addMap2(curTokenTvl, p.token0, (curUSD.get(p.token0) ?? 0) * st.reserve0)
    addMap2(curTokenTvl, p.token1, (curUSD.get(p.token1) ?? 0) * st.reserve1)
  }
  const writeTokens = db.transaction(() => {
    for (const t of tokenSet) {
      const m = meta.get(t)!
      const price = curUSD.get(t) ?? 0
      const hourVol = tokenHourVol.get(t)!
      const dayVol = tokenDayVol.get(t)!
      const hourPrice = tokenHourPrice.get(t)!
      const dayPrice = tokenDayPrice.get(t)!
      const supply = Number(m.totalSupply) / 10 ** m.decimals
      const fdv = price * supply
      insToken.run(
        t,
        m.symbol,
        m.name,
        m.decimals,
        m.totalSupply.toString(),
        m.logo,
        price,
        curTokenTvl.get(t) ?? 0,
        fdv,
        sumHour(hourVol, nowTs - HOUR),
        sumHour(hourVol, nowTs - DAY),
        sumDay(dayVol, nowTs - 7 * DAY),
        sumDay(dayVol, nowTs - 30 * DAY),
        sumDay(dayVol, nowTs - 365 * DAY),
        pct(price, priceAt(hourPrice, dayPrice, nowTs - HOUR, true)),
        pct(price, priceAt(hourPrice, dayPrice, nowTs - DAY, true)),
        pct(price, priceAt(hourPrice, dayPrice, nowTs - 7 * DAY, false)),
        pct(price, priceAt(hourPrice, dayPrice, nowTs - 30 * DAY, false)),
        pct(price, priceAt(hourPrice, dayPrice, nowTs - 365 * DAY, false)),
      )
    }
  })
  writeTokens()

  // pool snapshot: current tvl + trailing volumes from pool_day_data
  const poolDayVolRow = db.prepare<{ volumeUSD: number; day: number }>(
    'SELECT day, volumeUSD FROM pool_day_data WHERE poolId = ?',
  )
  const insPool = db.prepare(
    `INSERT OR REPLACE INTO pools
     (id,token0,token1,feeTier,createdBlock,createdTimestamp,tvlUSD,tvlChange1d,volume1d,volume7d,volume30d,feesUSD,txCount,
      token0Price,token1Price,token0Supply,token1Supply)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const writePools = db.transaction(() => {
    for (const p of pools) {
      const st = nowState.get(p.pool)!
      const p0 = curUSD.get(p.token0) ?? 0
      const p1 = curUSD.get(p.token1) ?? 0
      const tvl = p0 * st.reserve0 + p1 * st.reserve1
      const rows = poolDayVolRow.all(p.pool)
      let v1 = 0
      let v7 = 0
      let v30 = 0
      let tx = 0
      const a = agg.get(p.pool)!
      for (const [d, c] of a.dayTx) {
        if (d >= nowTs - 30 * DAY) {
          tx += c
        }
      }
      for (const row of rows) {
        if (row.day >= nowTs - DAY) {
          v1 += row.volumeUSD
        }
        if (row.day >= nowTs - 7 * DAY) {
          v7 += row.volumeUSD
        }
        if (row.day >= nowTs - 30 * DAY) {
          v30 += row.volumeUSD
        }
      }
      const spot = curPrice1per0.get(p.pool) ?? 0
      // tvl change vs previous day from pool_day_data
      const pdRow = poolDaily.get(p.pool)!
      const prevTvl =
        pdRow.reserve0.length > 1
          ? p0 * Math.max(0, pdRow.reserve0[pdRow.reserve0.length - 2]) + p1 * Math.max(0, pdRow.reserve1[pdRow.reserve1.length - 2])
          : tvl
      insPool.run(
        p.pool,
        p.token0,
        p.token1,
        p.fee,
        p.createdBlock,
        0,
        tvl,
        pct(tvl, prevTvl),
        v1,
        v7,
        v30,
        v1 * (p.fee / 1e6),
        tx,
        spot,
        spot > 0 ? 1 / spot : 0,
        st.reserve0,
        st.reserve1,
      )
    }
  })
  writePools()

  // 11) Transactions feed with USD (most recent first kept; bounded by TX_DAYS).
  const insTx = db.prepare(
    'INSERT OR REPLACE INTO transactions (id,hash,logIndex,type,poolId,token0,token1,amount0,amount1,amountUSD,account,timestamp,blockNumber) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  const writeTx = db.transaction(() => {
    for (const tx of recentTx) {
      const day = floorDay(tx.timestamp)
      const p0 = tokenDayPrice.get(tx.token0)?.get(day) ?? 0
      const p1 = tokenDayPrice.get(tx.token1)?.get(day) ?? 0
      const usd = p0 > 0 ? Math.abs(tx.amount0) * p0 : p1 > 0 ? Math.abs(tx.amount1) * p1 : 0
      insTx.run(
        `${tx.hash}-${tx.logIndex}`,
        tx.hash,
        tx.logIndex,
        tx.type,
        tx.poolId,
        tx.token0,
        tx.token1,
        tx.amount0,
        tx.amount1,
        usd,
        tx.account,
        tx.timestamp,
        tx.blockNumber,
      )
    }
  })
  writeTx()

  // 12) Meta.
  const insMeta = db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)')
  insMeta.run('updatedAtBlock', String(height))
  insMeta.run('updatedAt', String(nowTs))
  insMeta.run('indexDays', String(INDEX_DAYS))
  insMeta.run('chainId', '100')

  // Summary.
  const protoNow = db
    .query<{ tvl: number; vol: number }>('SELECT tvlUSD AS tvl, volumeUSD AS vol FROM protocol_day_data ORDER BY day DESC LIMIT 1')
    .get()
  const count = (sql: string): number => db.query<{ c: number }>(sql).get()?.c ?? 0
  console.log(
    `\nwrote ${count('SELECT count(*) AS c FROM tokens')} tokens, ` +
      `${count('SELECT count(*) AS c FROM pools')} pools, ` +
      `${count('SELECT count(*) AS c FROM token_day_data')} token-day rows, ` +
      `${count('SELECT count(*) AS c FROM transactions')} txns`,
  )
  console.log(`latest protocol day: TVL=$${(protoNow?.tvl ?? 0).toFixed(0)} vol=$${(protoNow?.vol ?? 0).toFixed(0)}`)
  console.log('\nTop 10 pools by TVL:')
  const top = db
    .query<{ id: string; tvlUSD: number; volume1d: number }>('SELECT id,tvlUSD,volume1d FROM pools ORDER BY tvlUSD DESC LIMIT 10')
    .all()
  for (const row of top) {
    const p = poolById.get(row.id)!
    console.log(
      `  ${meta.get(p.token0)?.symbol}/${meta.get(p.token1)?.symbol} ${p.fee} TVL=$${row.tvlUSD.toFixed(0)} vol1d=$${row.volume1d.toFixed(0)}`,
    )
  }
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

function addMap2(m: Map<string, number>, k: string, v: number): void {
  m.set(k, (m.get(k) ?? 0) + v)
}

/** Seed stables at $1 and propagate USD along the deepest pool, clamping junk. */
function propagateUSD(
  pools: Pool[],
  price1per0: Map<string, number>,
  depth: (poolId: string, usd: Map<string, number>) => number,
): Map<string, number> {
  const accept = (v: number): boolean => Number.isFinite(v) && v > 0 && v <= MAX_PRICE_USD
  const usd = new Map<string, number>()
  for (const p of pools) {
    if (USD_STABLES.has(p.token0)) {
      usd.set(p.token0, 1)
    }
    if (USD_STABLES.has(p.token1)) {
      usd.set(p.token1, 1)
    }
  }
  for (let round = 0; round < 6; round++) {
    const ranked = [...pools].sort((a, b) => depth(b.pool, usd) - depth(a.pool, usd))
    let changed = false
    for (const p of ranked) {
      const spot = price1per0.get(p.pool) ?? 0
      if (spot <= 0) {
        continue
      }
      const p0 = usd.get(p.token0)
      const p1 = usd.get(p.token1)
      if (p0 != null && p1 == null) {
        const cand = p0 / spot
        if (accept(cand)) {
          usd.set(p.token1, cand)
          changed = true
        }
      } else if (p1 != null && p0 == null) {
        const cand = p1 * spot
        if (accept(cand)) {
          usd.set(p.token0, cand)
          changed = true
        }
      }
    }
    if (!changed) {
      break
    }
  }
  return usd
}

async function fetchLogos(): Promise<Map<string, string>> {
  // Merge multiple Gnosis token lists by address (best-effort). CoinGecko's xdai
  // list is the broadest; the CoW Swap list is curated for the major Gnosis
  // tokens and is overlaid last so its (higher-quality) icons win on overlap.
  const sources: { url: string; pick: (json: unknown) => { address?: string; logoURI?: string }[] }[] = [
    {
      url: 'https://tokens.coingecko.com/xdai/all.json',
      pick: (j) => (j as { tokens?: { address?: string; logoURI?: string }[] }).tokens ?? [],
    },
    {
      url: 'https://files.cow.fi/tokens/CowSwap.json',
      pick: (j) =>
        ((j as { tokens?: { chainId?: number; address?: string; logoURI?: string }[] }).tokens ?? []).filter(
          (t) => t.chainId === 100,
        ),
    },
  ]
  const map = new Map<string, string>()
  for (const src of sources) {
    try {
      const res = await fetch(src.url)
      if (!res.ok) {
        continue
      }
      for (const t of src.pick(await res.json())) {
        if (t.address && t.logoURI) {
          map.set(t.address.toLowerCase(), t.logoURI)
        }
      }
    } catch {
      // logos are best-effort; ignore failures
    }
  }
  return map
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackfill().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
