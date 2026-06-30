/**
 * Long-running incremental HyperSync tailer for the Gnosis analytics DB.
 *
 * `backfill.ts` remains the full repair/bootstrap path. This worker keeps the
 * existing SQLite store fresh by reading new factory + pool events after
 * `meta.updatedAtBlock`, updating recent rollups, and periodically refreshing
 * current pool/token snapshots from RPC.
 */
import { createPublicClient, getAddress, http, parseAbi, type PublicClient } from 'viem'
import { gnosis } from 'viem/chains'
import { pathToFileURL } from 'node:url'
import { runBackfill } from './backfill.js'
import { getDb, initSchema } from './db.js'
import { applyOsgnoOracleUsdPrice, fetchOsgnoRate } from './osgnoOracle.js'

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
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 60_000)
const SYNC_FINALITY_BLOCKS = Number(process.env.SYNC_FINALITY_BLOCKS ?? 24)
const SYNC_SNAPSHOT_INTERVAL_MS = Number(process.env.SYNC_SNAPSHOT_INTERVAL_MS ?? 5 * 60_000)
const SYNC_ONCE = process.env.SYNC_ONCE === 'true'
const SYNC_BOOTSTRAP_BACKFILL = process.env.SYNC_BOOTSTRAP_BACKFILL !== 'false'
const TX_DAYS = Number(process.env.TX_DAYS ?? 7)

const DAY = 86_400
const HOUR = 3_600
const MAX_PRICE_USD = 1_000_000

const USD_STABLES = new Set<string>([
  '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', // WXDAI
  '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0', // USDC.e
  '0x4ecaba5870353805a9f068101a40e0f32ed605c6', // USDT
  '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', // USDC
  '0x44fa8e6f47987339850636f88629646662444217', // DAI
  '0xabef652195f98a91e490f047a5006b71c85f058d', // crvUSD
  '0xca5d8f8a8d49439357d3cf46ca2e720702f132b8', // GYD
])

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

interface TokenRow {
  id: string
  symbol: string
  name: string
  decimals: number
  totalSupply: string
  logo: string
  priceUSD: number
  tvlUSD: number
  fdv: number
  volume1h: number
  volume1d: number
  volume7d: number
  volume30d: number
  volume1y: number
  priceChange1h: number
  priceChange1d: number
  priceChange1w: number
  priceChange1m: number
  priceChange1y: number
}

interface PoolRow {
  id: string
  token0: string
  token1: string
  feeTier: number
  createdBlock: number
  createdTimestamp: number
  tvlUSD: number
  tvlChange1d: number
  volume1d: number
  volume7d: number
  volume30d: number
  feesUSD: number
  txCount: number
  token0Price: number
  token1Price: number
  token0Supply: number
  token1Supply: number
}

interface TokenMeta {
  id: string
  symbol: string
  name: string
  decimals: number
  totalSupply: bigint
}

interface PoolState {
  sqrt: bigint
  reserve0: number
  reserve1: number
}

interface RawEvent {
  id: string
  hash: string
  logIndex: number
  type: 'SWAP' | 'ADD' | 'REMOVE'
  poolId: string
  token0: string
  token1: string
  amount0: number
  amount1: number
  amountUSD: number
  volumeUSD: number
  account: string
  timestamp: number
  blockNumber: number
  token0Price: number
  token1Price: number
  feeUSD: number
}

// Rate-limit (429) plus transient gateway/server errors worth retrying.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

// Capped exponential backoff with jitter.
function backoffMs(attempt: number): number {
  const base = Math.min(1_500 * 2 ** attempt, 30_000)
  return base + Math.random() * base * 0.25
}

async function hyperQuery(body: unknown): Promise<HyperResponse> {
  if (!ENVIO_API_TOKEN) {
    throw new Error('ENVIO_API_TOKEN is required for HyperSync (https://envio.dev/app/api-tokens)')
  }
  let lastError: Error = new Error('HyperSync: too many retries')
  for (let attempt = 0; attempt < 15; attempt++) {
    let res: Response
    try {
      res = await fetch(HYPERSYNC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ENVIO_API_TOKEN}`,
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      // Network/connection failure — transient, retry with backoff.
      lastError = error instanceof Error ? error : new Error(String(error))
      await sleep(backoffMs(attempt))
      continue
    }
    if (res.ok) {
      return (await res.json()) as HyperResponse
    }
    // Fail fast on non-retryable client errors; back off on 429 + transient 5xx.
    if (!RETRYABLE_STATUS.has(res.status)) {
      throw new Error(`HyperSync ${res.status}: ${await res.text()}`)
    }
    lastError = new Error(`HyperSync ${res.status}: ${await res.text()}`)
    await sleep(backoffMs(attempt))
  }
  throw lastError
}

async function hyperHeight(): Promise<number> {
  const res = await fetch(HEIGHT_URL)
  if (!res.ok) {
    throw new Error(`HyperSync height ${res.status}: ${await res.text()}`)
  }
  return ((await res.json()) as { height: number }).height
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const floorDay = (ts: number): number => Math.floor(ts / DAY) * DAY
const floorHour = (ts: number): number => Math.floor(ts / HOUR) * HOUR

function int256(hex: string): bigint {
  let v = BigInt(hex)
  if (v >> 255n) {
    v -= 1n << 256n
  }
  return v
}
const uint = (hex: string): bigint => BigInt(hex)

function price1Per0(sqrtP: bigint, dec0: number, dec1: number): number {
  const Q96 = 1n << 96n
  const scaled = (sqrtP * sqrtP * 10n ** BigInt(dec0) * 10n ** 18n) / (10n ** BigInt(dec1) * Q96 * Q96)
  return Number(scaled) / 1e18
}

function ensureSyncSchema(): void {
  const db = getDb(true)
  initSchema(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_events (
      id          TEXT PRIMARY KEY,
      blockNumber INTEGER,
      timestamp   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sync_events_block ON sync_events(blockNumber);
  `)
}

function getMetaNumber(key: string): number | undefined {
  const value = getDb(true).query<{ value: string }>('SELECT value FROM meta WHERE key = ?').get(key)?.value
  if (value == null) {
    return undefined
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function setMeta(key: string, value: string | number): void {
  getDb(true).prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(key, String(value))
}

function loadPools(): PoolRow[] {
  return getDb(true).query<PoolRow>('SELECT * FROM pools ORDER BY createdBlock ASC').all()
}

function loadTokens(): TokenRow[] {
  return getDb(true).query<TokenRow>('SELECT * FROM tokens').all()
}

function loadTokenPrices(): Map<string, number> {
  return new Map(loadTokens().map((t) => [t.id, t.priceUSD]))
}

async function ensureBootstrapped(): Promise<void> {
  ensureSyncSchema()
  const last = getMetaNumber('updatedAtBlock')
  const poolCount = getDb(true).query<{ c: number }>('SELECT count(*) AS c FROM pools').get()?.c ?? 0
  if (last != null && poolCount > 0) {
    return
  }
  if (!SYNC_BOOTSTRAP_BACKFILL) {
    throw new Error('analytics DB has no updatedAtBlock; run bun src/backfill.ts or enable SYNC_BOOTSTRAP_BACKFILL')
  }
  console.log('analytics DB is empty; running one full backfill before starting incremental sync')
  await runBackfill()
  ensureSyncSchema()
}

async function fetchTokenMetas(client: PublicClient, addresses: string[]): Promise<Map<string, TokenMeta>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (unique.length === 0) {
    return new Map()
  }
  const calls = unique.flatMap((address) => [
    {
      address: address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'symbol' as const,
    },
    {
      address: address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'name' as const,
    },
    {
      address: address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'decimals' as const,
    },
    {
      address: address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'totalSupply' as const,
    },
  ])
  const res = await client.multicall({ contracts: calls, allowFailure: true })
  const metas = new Map<string, TokenMeta>()
  unique.forEach((address, i) => {
    const symbol = res[i * 4]
    const name = res[i * 4 + 1]
    const decimals = res[i * 4 + 2]
    const totalSupply = res[i * 4 + 3]
    metas.set(address, {
      id: address,
      symbol: symbol.status === 'success' ? (symbol.result as string) : address.slice(0, 8),
      name: name.status === 'success' ? (name.result as string) : address.slice(0, 8),
      decimals: decimals.status === 'success' ? Number(decimals.result) : 18,
      totalSupply: totalSupply.status === 'success' ? (totalSupply.result as bigint) : 0n,
    })
  })
  return metas
}

async function syncNewPools(client: PublicClient, fromBlock: number, toBlock: number): Promise<number> {
  if (fromBlock > toBlock) {
    return 0
  }
  const db = getDb(true)
  const existing = new Set(loadPools().map((p) => p.id))
  const discovered: {
    id: string
    token0: string
    token1: string
    feeTier: number
    createdBlock: number
    createdTimestamp: number
  }[] = []
  for (let from = fromBlock; ; ) {
    const r = await hyperQuery({
      from_block: from,
      to_block: toBlock + 1,
      logs: [{ address: [FACTORY], topics: [[POOL_CREATED_TOPIC]] }],
      field_selection: {
        log: ['topic1', 'topic2', 'topic3', 'data', 'block_number'],
        block: ['number', 'timestamp'],
      },
    })
    const blockTs = new Map<number, number>()
    for (const c of r.data) {
      for (const b of c.blocks ?? []) {
        blockTs.set(b.number, parseInt(b.timestamp, 16))
      }
      for (const lg of c.logs ?? []) {
        const id = getAddress('0x' + (lg.data ?? '').slice(2).slice(-40)).toLowerCase()
        if (existing.has(id)) {
          continue
        }
        existing.add(id)
        discovered.push({
          id,
          token0: getAddress('0x' + (lg.topic1 ?? '').slice(-40)).toLowerCase(),
          token1: getAddress('0x' + (lg.topic2 ?? '').slice(-40)).toLowerCase(),
          feeTier: Number(BigInt(lg.topic3 ?? '0x0')),
          createdBlock: lg.block_number ?? 0,
          createdTimestamp: blockTs.get(lg.block_number ?? 0) ?? 0,
        })
      }
    }
    if (!r.next_block || r.next_block <= from || r.next_block > toBlock) {
      break
    }
    from = r.next_block
  }
  if (discovered.length === 0) {
    return 0
  }

  const knownTokens = new Set(loadTokens().map((t) => t.id))
  const missingTokenIds = discovered.flatMap((p) => [p.token0, p.token1]).filter((id) => !knownTokens.has(id))
  const metas = await fetchTokenMetas(client, missingTokenIds)
  const insertToken = db.prepare(
    `INSERT OR IGNORE INTO tokens
     (id,symbol,name,decimals,totalSupply,logo,priceUSD,tvlUSD,fdv,volume1h,volume1d,volume7d,volume30d,volume1y,
      priceChange1h,priceChange1d,priceChange1w,priceChange1m,priceChange1y)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insertPool = db.prepare(
    `INSERT OR IGNORE INTO pools
     (id,token0,token1,feeTier,createdBlock,createdTimestamp,tvlUSD,tvlChange1d,volume1d,volume7d,volume30d,feesUSD,txCount,
      token0Price,token1Price,token0Supply,token1Supply)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const write = db.transaction(() => {
    for (const meta of metas.values()) {
      insertToken.run(
        meta.id,
        meta.symbol,
        meta.name,
        meta.decimals,
        meta.totalSupply.toString(),
        '',
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      )
    }
    for (const pool of discovered) {
      insertPool.run(
        pool.id,
        pool.token0,
        pool.token1,
        pool.feeTier,
        pool.createdBlock,
        pool.createdTimestamp,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      )
    }
  })
  write()
  console.log(`discovered ${discovered.length} new pools`)
  return discovered.length
}

async function fetchPoolStates(
  client: PublicClient,
  pools: PoolRow[],
  tokenDecimals: Map<string, number>,
): Promise<Map<string, PoolState>> {
  if (pools.length === 0) {
    return new Map()
  }
  const calls = pools.flatMap((p) => [
    {
      address: p.id as `0x${string}`,
      abi: poolAbi,
      functionName: 'slot0' as const,
    },
    {
      address: p.token0 as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [p.id as `0x${string}`],
    },
    {
      address: p.token1 as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [p.id as `0x${string}`],
    },
  ])
  const res = await client.multicall({ contracts: calls, allowFailure: true })
  const states = new Map<string, PoolState>()
  pools.forEach((p, i) => {
    const slot0 = res[i * 3]
    const bal0 = res[i * 3 + 1]
    const bal1 = res[i * 3 + 2]
    const sqrt = slot0.status === 'success' ? (slot0.result as unknown as bigint[])[0] : 0n
    const dec0 = tokenDecimals.get(p.token0) ?? 18
    const dec1 = tokenDecimals.get(p.token1) ?? 18
    states.set(p.id, {
      sqrt,
      reserve0: bal0.status === 'success' ? Number(bal0.result as bigint) / 10 ** dec0 : 0,
      reserve1: bal1.status === 'success' ? Number(bal1.result as bigint) / 10 ** dec1 : 0,
    })
  })
  return states
}

function propagateUSD(
  pools: PoolRow[],
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
    const ranked = [...pools].sort((a, b) => depth(b.id, usd) - depth(a.id, usd))
    let changed = false
    for (const p of ranked) {
      const spot = price1per0.get(p.id) ?? 0
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

async function refreshCurrentSnapshots(client: PublicClient, pools: PoolRow[]): Promise<Map<string, number>> {
  const db = getDb(true)
  const tokens = loadTokens()
  const osgnoRate = await fetchOsgnoRate(client).catch((error) => {
    console.warn('osGNO oracle price unavailable; leaving indexed osGNO price unchanged', error)
    return undefined
  })
  const tokenDecimals = new Map(tokens.map((t) => [t.id, t.decimals]))
  const states = await fetchPoolStates(client, pools, tokenDecimals)
  const price1per0 = new Map<string, number>()
  for (const p of pools) {
    const st = states.get(p.id)
    price1per0.set(
      p.id,
      st && st.sqrt > 0n
        ? price1Per0(st.sqrt, tokenDecimals.get(p.token0) ?? 18, tokenDecimals.get(p.token1) ?? 18)
        : 0,
    )
  }
  const usd = propagateUSD(pools, price1per0, (poolId, knownUsd) => {
    const pool = pools.find((p) => p.id === poolId)
    const st = states.get(poolId)
    if (!pool || !st) {
      return 0
    }
    return (knownUsd.get(pool.token0) ?? 0) * st.reserve0 + (knownUsd.get(pool.token1) ?? 0) * st.reserve1
  })
  applyOsgnoOracleUsdPrice(usd, osgnoRate)

  const nowTs = Math.floor(Date.now() / 1000)
  const today = floorDay(nowTs)
  const thisHour = floorHour(nowTs)
  const tokenTvl = new Map<string, number>()
  const addTokenTvl = (id: string, value: number): void => {
    tokenTvl.set(id, (tokenTvl.get(id) ?? 0) + value)
  }
  for (const p of pools) {
    const st = states.get(p.id)
    if (!st) {
      continue
    }
    addTokenTvl(p.token0, (usd.get(p.token0) ?? 0) * st.reserve0)
    addTokenTvl(p.token1, (usd.get(p.token1) ?? 0) * st.reserve1)
  }

  const updateToken = db.prepare('UPDATE tokens SET priceUSD = ?, tvlUSD = ?, fdv = ? WHERE id = ?')
  const updatePool = db.prepare(
    `UPDATE pools SET tvlUSD = ?, token0Supply = ?, token1Supply = ?,
       token0Price = CASE WHEN ? > 0 THEN ? ELSE token0Price END,
       token1Price = CASE WHEN ? > 0 THEN ? ELSE token1Price END
     WHERE id = ?`,
  )
  const upsertTokenDay = db.prepare(
    `INSERT INTO token_day_data (tokenId,day,priceUSD,volumeUSD,tvlUSD) VALUES (?,?,?,?,?)
     ON CONFLICT(tokenId, day) DO UPDATE SET
       priceUSD = excluded.priceUSD,
       tvlUSD = excluded.tvlUSD`,
  )
  const upsertTokenHour = db.prepare(
    `INSERT INTO token_hour_data (tokenId,hour,priceUSD,volumeUSD) VALUES (?,?,?,?)
     ON CONFLICT(tokenId, hour) DO UPDATE SET priceUSD = excluded.priceUSD`,
  )
  const upsertPoolDay = db.prepare(
    `INSERT INTO pool_day_data (poolId,day,volumeUSD,tvlUSD,feesUSD,token0Price,token1Price,txCount) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(poolId, day) DO UPDATE SET
       tvlUSD = excluded.tvlUSD,
       token0Price = CASE WHEN excluded.token0Price > 0 THEN excluded.token0Price ELSE pool_day_data.token0Price END,
       token1Price = CASE WHEN excluded.token1Price > 0 THEN excluded.token1Price ELSE pool_day_data.token1Price END`,
  )
  const upsertPoolHour = db.prepare(
    `INSERT INTO pool_hour_data (poolId,hour,volumeUSD,token0Price,token1Price) VALUES (?,?,?,?,?)
     ON CONFLICT(poolId, hour) DO UPDATE SET
       token0Price = CASE WHEN excluded.token0Price > 0 THEN excluded.token0Price ELSE pool_hour_data.token0Price END,
       token1Price = CASE WHEN excluded.token1Price > 0 THEN excluded.token1Price ELSE pool_hour_data.token1Price END`,
  )
  const upsertProtocolDay = db.prepare(
    `INSERT INTO protocol_day_data (day,tvlUSD,volumeUSD) VALUES (?,?,?)
     ON CONFLICT(day) DO UPDATE SET tvlUSD = excluded.tvlUSD`,
  )

  let protocolTvl = 0
  const write = db.transaction(() => {
    for (const t of tokens) {
      const price = usd.get(t.id) ?? 0
      const tvl = tokenTvl.get(t.id) ?? 0
      const supply = Number(t.totalSupply) / 10 ** t.decimals
      updateToken.run(price, tvl, price * supply, t.id)
      upsertTokenDay.run(t.id, today, price, 0, tvl)
      upsertTokenHour.run(t.id, thisHour, price, 0)
    }
    for (const p of pools) {
      const st = states.get(p.id)
      if (!st) {
        continue
      }
      const tvl = (usd.get(p.token0) ?? 0) * st.reserve0 + (usd.get(p.token1) ?? 0) * st.reserve1
      const spot = price1per0.get(p.id) ?? 0
      // token0Price = token0 per token1 (1/spot); token1Price = token1 per token0 (spot)
      const token0Price = spot > 0 ? 1 / spot : 0
      const token1Price = spot
      protocolTvl += tvl
      updatePool.run(tvl, st.reserve0, st.reserve1, token0Price, token0Price, token1Price, token1Price, p.id)
      upsertPoolDay.run(p.id, today, 0, tvl, 0, token0Price, token1Price, 0)
      upsertPoolHour.run(p.id, thisHour, 0, token0Price, token1Price)
    }
    upsertProtocolDay.run(today, protocolTvl, 0)
    setMeta('lastSnapshotAt', nowTs)
  })
  write()
  return usd
}

function parsePoolEvent(
  lg: HyperLog,
  pool: PoolRow,
  timestamp: number,
  account: string,
  tokenDecimals: Map<string, number>,
  tokenPrices: Map<string, number>,
): RawEvent | undefined {
  const raw = (lg.data ?? '0x').slice(2)
  const dec0 = tokenDecimals.get(pool.token0) ?? 18
  const dec1 = tokenDecimals.get(pool.token1) ?? 18
  const blockNumber = lg.block_number ?? 0
  const logIndex = lg.log_index ?? 0
  const hash = lg.transaction_hash ?? ''
  const id = `${hash}-${logIndex}`
  let type: RawEvent['type']
  let amount0 = 0
  let amount1 = 0
  let sqrt = 0n

  if (lg.topic0 === SWAP_TOPIC) {
    type = 'SWAP'
    amount0 = Number(int256('0x' + raw.slice(0, 64))) / 10 ** dec0
    amount1 = Number(int256('0x' + raw.slice(64, 128))) / 10 ** dec1
    sqrt = uint('0x' + raw.slice(128, 192))
  } else if (lg.topic0 === MINT_TOPIC) {
    type = 'ADD'
    amount0 = Number(uint('0x' + raw.slice(128, 192))) / 10 ** dec0
    amount1 = Number(uint('0x' + raw.slice(192, 256))) / 10 ** dec1
  } else if (lg.topic0 === BURN_TOPIC) {
    type = 'REMOVE'
    amount0 = -Number(uint('0x' + raw.slice(64, 128))) / 10 ** dec0
    amount1 = -Number(uint('0x' + raw.slice(128, 192))) / 10 ** dec1
  } else {
    return undefined
  }

  const p0 = tokenPrices.get(pool.token0) ?? 0
  const p1 = tokenPrices.get(pool.token1) ?? 0
  const amountUSD = p0 > 0 ? Math.abs(amount0) * p0 : p1 > 0 ? Math.abs(amount1) * p1 : 0
  const volumeUSD = type === 'SWAP' ? amountUSD : 0
  const spot = sqrt > 0n ? price1Per0(sqrt, dec0, dec1) : 0
  return {
    id,
    hash,
    logIndex,
    type,
    poolId: pool.id,
    token0: pool.token0,
    token1: pool.token1,
    amount0,
    amount1,
    amountUSD,
    volumeUSD,
    account,
    timestamp,
    blockNumber,
    // token0Price = token0 per token1 (1/spot); token1Price = token1 per token0 (spot)
    token0Price: spot > 0 ? 1 / spot : 0,
    token1Price: spot,
    feeUSD: volumeUSD * (pool.feeTier / 1e6),
  }
}

async function fetchNewEvents(
  fromBlock: number,
  toBlock: number,
  pools: PoolRow[],
  tokenPrices: Map<string, number>,
): Promise<RawEvent[]> {
  if (fromBlock > toBlock || pools.length === 0) {
    return []
  }
  const poolById = new Map(pools.map((p) => [p.id, p]))
  const tokenDecimals = new Map(loadTokens().map((t) => [t.id, t.decimals]))
  const events: RawEvent[] = []
  // Scaling note: every known pool address is sent in one log selection. Efficient at
  // current pool counts; if the list grows large enough to hit request-size/planning
  // limits, drop the address filter (topic-only scan) and keep the local poolById
  // filter below, or chunk poolAddresses across multiple queries.
  const poolAddresses = pools.map((p) => p.id)
  for (let from = fromBlock; ; ) {
    const r = await hyperQuery({
      from_block: from,
      to_block: toBlock + 1,
      logs: [
        {
          address: poolAddresses,
          topics: [[SWAP_TOPIC, MINT_TOPIC, BURN_TOPIC]],
        },
      ],
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
      for (const tx of c.transactions ?? []) {
        txFrom.set(tx.hash, tx.from)
      }
      for (const lg of c.logs ?? []) {
        const pool = poolById.get(lg.address.toLowerCase())
        if (!pool) {
          continue
        }
        const parsed = parsePoolEvent(
          lg,
          pool,
          blockTs.get(lg.block_number ?? 0) ?? Math.floor(Date.now() / 1000),
          txFrom.get(lg.transaction_hash ?? '') ?? '',
          tokenDecimals,
          tokenPrices,
        )
        if (parsed) {
          events.push(parsed)
        }
      }
    }
    if (!r.next_block || r.next_block <= from || r.next_block > toBlock) {
      break
    }
    from = r.next_block
  }
  return events
}

function applyEvents(events: RawEvent[]): number {
  if (events.length === 0) {
    return 0
  }
  const db = getDb(true)
  const seen = db.prepare('SELECT 1 AS v FROM sync_events WHERE id = ?')
  const insertSeen = db.prepare('INSERT INTO sync_events (id,blockNumber,timestamp) VALUES (?,?,?)')
  const upsertPoolDay = db.prepare(
    `INSERT INTO pool_day_data (poolId,day,volumeUSD,tvlUSD,feesUSD,token0Price,token1Price,txCount) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(poolId, day) DO UPDATE SET
       volumeUSD = pool_day_data.volumeUSD + excluded.volumeUSD,
       feesUSD = pool_day_data.feesUSD + excluded.feesUSD,
       token0Price = CASE WHEN excluded.token0Price > 0 THEN excluded.token0Price ELSE pool_day_data.token0Price END,
       token1Price = CASE WHEN excluded.token1Price > 0 THEN excluded.token1Price ELSE pool_day_data.token1Price END,
       txCount = pool_day_data.txCount + excluded.txCount`,
  )
  const upsertTokenDay = db.prepare(
    `INSERT INTO token_day_data (tokenId,day,priceUSD,volumeUSD,tvlUSD) VALUES (?,?,?,?,?)
     ON CONFLICT(tokenId, day) DO UPDATE SET
       volumeUSD = token_day_data.volumeUSD + excluded.volumeUSD,
       priceUSD = CASE WHEN excluded.priceUSD > 0 THEN excluded.priceUSD ELSE token_day_data.priceUSD END`,
  )
  const upsertTokenHour = db.prepare(
    `INSERT INTO token_hour_data (tokenId,hour,priceUSD,volumeUSD) VALUES (?,?,?,?)
     ON CONFLICT(tokenId, hour) DO UPDATE SET
       volumeUSD = token_hour_data.volumeUSD + excluded.volumeUSD,
       priceUSD = CASE WHEN excluded.priceUSD > 0 THEN excluded.priceUSD ELSE token_hour_data.priceUSD END`,
  )
  const upsertPoolHour = db.prepare(
    `INSERT INTO pool_hour_data (poolId,hour,volumeUSD,token0Price,token1Price) VALUES (?,?,?,?,?)
     ON CONFLICT(poolId, hour) DO UPDATE SET
       volumeUSD = pool_hour_data.volumeUSD + excluded.volumeUSD,
       token0Price = CASE WHEN excluded.token0Price > 0 THEN excluded.token0Price ELSE pool_hour_data.token0Price END,
       token1Price = CASE WHEN excluded.token1Price > 0 THEN excluded.token1Price ELSE pool_hour_data.token1Price END`,
  )
  const upsertProtocolDay = db.prepare(
    `INSERT INTO protocol_day_data (day,tvlUSD,volumeUSD) VALUES (?,?,?)
     ON CONFLICT(day) DO UPDATE SET volumeUSD = protocol_day_data.volumeUSD + excluded.volumeUSD`,
  )
  const insertTx = db.prepare(
    'INSERT OR REPLACE INTO transactions (id,hash,logIndex,type,poolId,token0,token1,amount0,amount1,amountUSD,account,timestamp,blockNumber) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  const tokenPrice = loadTokenPrices()

  let applied = 0
  const write = db.transaction(() => {
    for (const ev of events) {
      if (seen.get(ev.id)) {
        continue
      }
      insertSeen.run(ev.id, ev.blockNumber, ev.timestamp)
      const day = floorDay(ev.timestamp)
      const hour = floorHour(ev.timestamp)
      // Count every event (swap/mint/burn) toward pool txCount, matching Uniswap
      // subgraph semantics; parsePoolEvent only returns these three types.
      const txCount = 1
      upsertPoolDay.run(ev.poolId, day, ev.volumeUSD, 0, ev.feeUSD, ev.token0Price, ev.token1Price, txCount)
      upsertPoolHour.run(ev.poolId, hour, ev.volumeUSD, ev.token0Price, ev.token1Price)
      upsertTokenDay.run(ev.token0, day, tokenPrice.get(ev.token0) ?? 0, ev.volumeUSD, 0)
      upsertTokenDay.run(ev.token1, day, tokenPrice.get(ev.token1) ?? 0, ev.volumeUSD, 0)
      upsertTokenHour.run(ev.token0, hour, tokenPrice.get(ev.token0) ?? 0, ev.volumeUSD)
      upsertTokenHour.run(ev.token1, hour, tokenPrice.get(ev.token1) ?? 0, ev.volumeUSD)
      upsertProtocolDay.run(day, 0, ev.volumeUSD)
      insertTx.run(
        ev.id,
        ev.hash,
        ev.logIndex,
        ev.type,
        ev.poolId,
        ev.token0,
        ev.token1,
        ev.amount0,
        ev.amount1,
        ev.amountUSD,
        ev.account,
        ev.timestamp,
        ev.blockNumber,
      )
      applied++
    }
  })
  write()
  return applied
}

function sumValue(sql: string, ...args: (string | number)[]): number {
  return (
    getDb(true)
      .query<{ v: number }>(sql)
      .get(...args)?.v ?? 0
  )
}

function priceAt(tokenId: string, ts: number, hourly: boolean): number {
  const db = getDb(true)
  if (hourly) {
    return (
      db
        .query<{ priceUSD: number }>(
          'SELECT priceUSD FROM token_hour_data WHERE tokenId = ? AND hour <= ? AND priceUSD > 0 ORDER BY hour DESC LIMIT 1',
        )
        .get(tokenId, floorHour(ts))?.priceUSD ?? 0
    )
  }
  return (
    db
      .query<{ priceUSD: number }>(
        'SELECT priceUSD FROM token_day_data WHERE tokenId = ? AND day <= ? AND priceUSD > 0 ORDER BY day DESC LIMIT 1',
      )
      .get(tokenId, floorDay(ts))?.priceUSD ?? 0
  )
}

function pct(now: number, then: number): number {
  if (!(then > 0)) {
    return 0
  }
  const value = ((now - then) / then) * 100
  return Number.isFinite(value) && Math.abs(value) < 1e6 ? value : 0
}

function refreshRollingStats(): void {
  const db = getDb(true)
  const nowTs = Math.floor(Date.now() / 1000)
  const updateToken = db.prepare(
    `UPDATE tokens SET
       volume1h = ?, volume1d = ?, volume7d = ?, volume30d = ?, volume1y = ?,
       priceChange1h = ?, priceChange1d = ?, priceChange1w = ?, priceChange1m = ?, priceChange1y = ?
     WHERE id = ?`,
  )
  const updatePool = db.prepare(
    'UPDATE pools SET volume1d = ?, volume7d = ?, volume30d = ?, feesUSD = ?, txCount = ? WHERE id = ?',
  )
  const deleteOldTx = db.prepare('DELETE FROM transactions WHERE timestamp < ?')
  const deleteOldSeen = db.prepare('DELETE FROM sync_events WHERE timestamp < ?')

  const write = db.transaction(() => {
    for (const t of loadTokens()) {
      const volume1h = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM token_hour_data WHERE tokenId = ? AND hour >= ?',
        t.id,
        nowTs - HOUR,
      )
      const volume1d = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM token_hour_data WHERE tokenId = ? AND hour >= ?',
        t.id,
        nowTs - DAY,
      )
      const volume7d = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM token_day_data WHERE tokenId = ? AND day >= ?',
        t.id,
        nowTs - 7 * DAY,
      )
      const volume30d = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM token_day_data WHERE tokenId = ? AND day >= ?',
        t.id,
        nowTs - 30 * DAY,
      )
      const volume1y = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM token_day_data WHERE tokenId = ? AND day >= ?',
        t.id,
        nowTs - 365 * DAY,
      )
      updateToken.run(
        volume1h,
        volume1d,
        volume7d,
        volume30d,
        volume1y,
        pct(t.priceUSD, priceAt(t.id, nowTs - HOUR, true)),
        pct(t.priceUSD, priceAt(t.id, nowTs - DAY, true)),
        pct(t.priceUSD, priceAt(t.id, nowTs - 7 * DAY, false)),
        pct(t.priceUSD, priceAt(t.id, nowTs - 30 * DAY, false)),
        pct(t.priceUSD, priceAt(t.id, nowTs - 365 * DAY, false)),
        t.id,
      )
    }
    for (const p of loadPools()) {
      const volume1d = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM pool_day_data WHERE poolId = ? AND day >= ?',
        p.id,
        nowTs - DAY,
      )
      const volume7d = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM pool_day_data WHERE poolId = ? AND day >= ?',
        p.id,
        nowTs - 7 * DAY,
      )
      const volume30d = sumValue(
        'SELECT COALESCE(SUM(volumeUSD),0) AS v FROM pool_day_data WHERE poolId = ? AND day >= ?',
        p.id,
        nowTs - 30 * DAY,
      )
      const fees1d = sumValue(
        'SELECT COALESCE(SUM(feesUSD),0) AS v FROM pool_day_data WHERE poolId = ? AND day >= ?',
        p.id,
        nowTs - DAY,
      )
      const txCount = sumValue(
        'SELECT COALESCE(SUM(txCount),0) AS v FROM pool_day_data WHERE poolId = ? AND day >= ?',
        p.id,
        nowTs - 30 * DAY,
      )
      updatePool.run(volume1d, volume7d, volume30d, fees1d, txCount, p.id)
    }
    deleteOldTx.run(nowTs - TX_DAYS * DAY)
    deleteOldSeen.run(nowTs - 2 * DAY)
  })
  write()
}

async function syncOnce(client: PublicClient): Promise<void> {
  await ensureBootstrapped()
  const height = await hyperHeight()
  const target = Math.max(FACTORY_START_BLOCK, height - SYNC_FINALITY_BLOCKS)
  const last = getMetaNumber('updatedAtBlock') ?? FACTORY_START_BLOCK
  if (target <= last) {
    console.log(`sync idle: height=${height} target=${target} last=${last}`)
    return
  }

  const fromBlock = last + 1
  const newPools = await syncNewPools(client, fromBlock, target)
  const pools = loadPools()
  const lastSnapshotAt = getMetaNumber('lastSnapshotAt') ?? 0
  const nowTs = Math.floor(Date.now() / 1000)
  let tokenPrices = loadTokenPrices()
  const snapshotDue = newPools > 0 || nowTs - lastSnapshotAt >= SYNC_SNAPSHOT_INTERVAL_MS / 1000
  if (snapshotDue) {
    tokenPrices = await refreshCurrentSnapshots(client, pools)
  }

  const events = await fetchNewEvents(fromBlock, target, pools, tokenPrices)
  const applied = applyEvents(events)
  if (events.length > 0 || snapshotDue) {
    refreshRollingStats()
  }
  setMeta('updatedAtBlock', target)
  setMeta('updatedAt', nowTs)
  setMeta('syncMode', 'incremental')
  console.log(
    `sync ${fromBlock}..${target}: events=${events.length}, applied=${applied}, newPools=${newPools}, snapshot=${
      snapshotDue ? 'yes' : 'no'
    }`,
  )
}

export async function runSyncLoop(): Promise<void> {
  const client = createPublicClient({
    chain: gnosis,
    transport: http(RPC_URL),
  })
  console.log(
    `gnosis analytics sync starting: interval=${SYNC_INTERVAL_MS}ms finality=${SYNC_FINALITY_BLOCKS} blocks snapshot=${SYNC_SNAPSHOT_INTERVAL_MS}ms rpc=${RPC_URL}`,
  )
  for (;;) {
    try {
      await syncOnce(client)
    } catch (error) {
      console.error('sync failed', error)
    }
    if (SYNC_ONCE) {
      return
    }
    await sleep(SYNC_INTERVAL_MS)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyncLoop().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
