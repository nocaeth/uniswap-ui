/**
 * Envio HyperIndex event handlers — Uniswap V3 on Gnosis.
 *
 * This is a working skeleton: it registers pools from the factory, keeps live pool
 * state, and writes the entities/rollups the analytics adapter serves to the UI.
 * The TODOs mark the two pieces that need project-specific decisions:
 *   1) USD pricing (a price feed, since Uniswap's price service won't serve Gnosis)
 *   2) precise token-amount math (decimals + tick math) if you want exact figures.
 *
 * Generated handler/entity types come from `envio codegen` (run after editing
 * config.yaml / schema.graphql). See https://docs.envio.dev
 */
import { Factory, Pool } from 'generated'

// --- USD pricing -----------------------------------------------------------
// Gnosis stables are ~$1; treat WXDAI/USDC.e/USDT as $1 and derive other tokens
// from their pool ratio against a stable. For production, replace with a real
// feed (CoinGecko / Chainlink) keyed by token address + block timestamp.
const STABLE_ADDRESSES = new Set<string>([
  '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', // WXDAI
  '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0', // USDC.e
  '0x4ecaba5870353805a9f068101a8e0e64dd33cd47', // USDT
])

function isStable(addr: string): boolean {
  return STABLE_ADDRESSES.has(addr.toLowerCase())
}

// Register each new pool for indexing as the factory emits PoolCreated.
Factory.PoolCreated.contractRegister(({ event, context }) => {
  context.addPool(event.params.pool)
})

Factory.PoolCreated.handler(async ({ event, context }) => {
  const token0 = await ensureToken(context, event.params.token0)
  const token1 = await ensureToken(context, event.params.token1)
  context.Pool.set({
    id: event.params.pool.toLowerCase(),
    token0_id: token0.id,
    token1_id: token1.id,
    feeTier: Number(event.params.fee),
    liquidity: 0n,
    sqrtPriceX96: 0n,
    tick: 0,
    totalValueLockedUSD: 0,
    volumeUSD: 0,
    feesUSD: 0,
    txCount: 0,
    createdAtTimestamp: event.block.timestamp,
  })
})

Pool.Initialize.handler(async ({ event, context }) => {
  const id = event.srcAddress.toLowerCase()
  const pool = await context.Pool.get(id)
  if (!pool) return
  context.Pool.set({ ...pool, sqrtPriceX96: event.params.sqrtPriceX96, tick: Number(event.params.tick) })
})

Pool.Swap.handler(async ({ event, context }) => {
  const id = event.srcAddress.toLowerCase()
  const pool = await context.Pool.get(id)
  if (!pool) return

  // TODO: convert raw amounts using token decimals + price feed for exact USD.
  const amountUSD = approxSwapUSD(event.params.amount0, event.params.amount1)

  context.Pool.set({
    ...pool,
    sqrtPriceX96: event.params.sqrtPriceX96,
    liquidity: event.params.liquidity,
    tick: Number(event.params.tick),
    volumeUSD: pool.volumeUSD + amountUSD,
    feesUSD: pool.feesUSD + (amountUSD * pool.feeTier) / 1_000_000,
    txCount: pool.txCount + 1,
  })

  context.Transaction.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    type: 'swap',
    pool_id: id,
    origin: event.params.sender,
    amount0: Number(event.params.amount0),
    amount1: Number(event.params.amount1),
    amountUSD,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  })

  // TODO: upsert PoolDayData / PoolHourData / TokenDayData rollups here using
  // floor(timestamp / 86400) and floor(timestamp / 3600) bucket keys.
})

// Mint/Burn/Collect follow the same shape: update pool liquidity + TVL and write a
// Transaction row. Left as TODO to keep this skeleton focused.
Pool.Mint.handler(async ({ event, context }) => {
  void event
  void context
})
Pool.Burn.handler(async ({ event, context }) => {
  void event
  void context
})
Pool.Collect.handler(async ({ event, context }) => {
  void event
  void context
})

// --- helpers ---------------------------------------------------------------

async function ensureToken(context: any, address: string) {
  const id = address.toLowerCase()
  const existing = await context.Token.get(id)
  if (existing) return existing
  const token = {
    id,
    // TODO: fetch symbol/name/decimals via an effect/RPC call; defaults below.
    symbol: isStable(id) ? 'STABLE' : 'UNKNOWN',
    name: id,
    decimals: 18,
    totalValueLocked: 0,
    totalValueLockedUSD: 0,
    volumeUSD: 0,
    txCount: 0,
    derivedXDAI: isStable(id) ? 1 : 0,
  }
  context.Token.set(token)
  return token
}

function approxSwapUSD(amount0: bigint, amount1: bigint): number {
  // Placeholder: magnitude of the larger leg as a rough proxy. Replace with
  // decimals-aware + priced conversion. Kept non-zero so charts render in dev.
  const a0 = amount0 < 0n ? -amount0 : amount0
  const a1 = amount1 < 0n ? -amount1 : amount1
  const max = a0 > a1 ? a0 : a1
  return Number(max) / 1e18
}
