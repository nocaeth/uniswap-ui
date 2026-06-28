import { FeeAmount, TICK_SPACINGS } from '@uniswap/v3-sdk'
import { createPublicClient, getAddress, http, type Address, type PublicClient } from 'viem'
import { gnosis } from 'viem/chains'

// On-chain reads for the V3 liquidity/depth chart (GraphQL V3Pool.ticks). The
// indexer has no per-tick data, so enumerate the tick bitmap directly. Reads
// from the same node the positions service uses.
const RPC_URL =
  process.env.POSITIONS_RPC_URL ?? process.env.GNOSIS_RPC_URL ?? process.env.RPC_GNOSIS ?? 'http://localhost:8545'

const client: PublicClient = createPublicClient({ chain: gnosis, transport: http(RPC_URL) })

const MIN_TICK = -887272
const MAX_TICK = 887272
const BITMAP_MULTICALL_CHUNK_SIZE = 512
const TICK_MULTICALL_CHUNK_SIZE = 512
const CACHE_TTL_MS = 60_000

const POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { type: 'function', name: 'tickBitmap', stateMutability: 'view', inputs: [{ type: 'int16' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'ticks',
    stateMutability: 'view',
    inputs: [{ type: 'int24' }],
    outputs: [
      { name: 'liquidityGross', type: 'uint128' },
      { name: 'liquidityNet', type: 'int128' },
      { name: 'feeGrowthOutside0X128', type: 'uint256' },
      { name: 'feeGrowthOutside1X128', type: 'uint256' },
      { name: 'tickCumulativeOutside', type: 'int56' },
      { name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
      { name: 'secondsOutside', type: 'uint32' },
      { name: 'initialized', type: 'bool' },
    ],
  },
] as const

export interface OnchainTick {
  tickIdx: number
  liquidityGross: bigint
  liquidityNet: bigint
}

export function feeToTickSpacing(feeTier: number): number {
  return feeTier in TICK_SPACINGS ? TICK_SPACINGS[feeTier as FeeAmount] : 60
}

function getBitmapWordPositions(tickSpacing: number): number[] {
  const minWord = Math.floor(MIN_TICK / tickSpacing) >> 8
  const maxWord = Math.floor(MAX_TICK / tickSpacing) >> 8
  const wordPositions: number[] = []

  for (let w = minWord; w <= maxWord; w++) {
    wordPositions.push(w)
  }

  return wordPositions
}

async function readBitmapWords(address: Address, wordPositions: number[]): Promise<bigint[]> {
  const results: bigint[] = []

  for (let i = 0; i < wordPositions.length; i += BITMAP_MULTICALL_CHUNK_SIZE) {
    const chunk = wordPositions.slice(i, i + BITMAP_MULTICALL_CHUNK_SIZE)
    const bitmaps = (await client.multicall({
      allowFailure: true,
      contracts: chunk.map((w) => ({ address, abi: POOL_ABI, functionName: 'tickBitmap' as const, args: [w] })),
    })) as { status: 'success' | 'failure'; result?: bigint }[]

    results.push(...bitmaps.map((b) => (b.status === 'success' && b.result !== undefined ? b.result : 0n)))
  }

  return results
}

async function readTicks(address: Address, ticks: number[]): Promise<OnchainTick[]> {
  const result: OnchainTick[] = []

  for (let i = 0; i < ticks.length; i += TICK_MULTICALL_CHUNK_SIZE) {
    const chunk = ticks.slice(i, i + TICK_MULTICALL_CHUNK_SIZE)
    const tickData = (await client.multicall({
      allowFailure: true,
      contracts: chunk.map((t) => ({ address, abi: POOL_ABI, functionName: 'ticks' as const, args: [t] })),
    })) as { status: 'success' | 'failure'; result?: readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean] }[]

    chunk.forEach((tickIdx, chunkIndex) => {
      const data = tickData[chunkIndex]
      if (data?.status !== 'success' || !data.result) {
        return
      }
      result.push({ tickIdx, liquidityGross: data.result[0], liquidityNet: data.result[1] })
    })
  }

  return result
}

async function enumeratePoolTicks(poolAddress: string, tickSpacing: number): Promise<OnchainTick[]> {
  const address = getAddress(poolAddress)
  const wordPositions = getBitmapWordPositions(tickSpacing)
  const bitmaps = await readBitmapWords(address, wordPositions)

  const initializedTicks: number[] = []
  bitmaps.forEach((word, i) => {
    if (word === 0n) {
      return
    }
    const wordPos = wordPositions[i]
    for (let bit = 0; bit < 256; bit++) {
      if (((word >> BigInt(bit)) & 1n) === 1n) {
        const tickIdx = (wordPos * 256 + bit) * tickSpacing
        if (tickIdx >= MIN_TICK && tickIdx <= MAX_TICK) {
          initializedTicks.push(tickIdx)
        }
      }
    }
  })
  if (initializedTicks.length === 0) {
    return []
  }

  const result = await readTicks(address, initializedTicks)
  result.sort((a, b) => a.tickIdx - b.tickIdx)
  return result
}

const cache = new Map<string, { ts: number; promise: Promise<OnchainTick[]> }>()

/** Enumerate initialized ticks for a pool, cached briefly (the client polls ~30s). */
export function getPoolTicks(poolAddress: string, tickSpacing: number): Promise<OnchainTick[]> {
  const key = poolAddress.toLowerCase()
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return hit.promise
  }
  const promise = enumeratePoolTicks(poolAddress, tickSpacing).catch((e) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, { ts: now, promise })
  return promise
}
