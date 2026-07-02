vi.mock('uniswap/src/config', () => ({
  config: {
    graphqlUrlOverride: 'https://analytics.example/v1/graphql',
  },
}))

vi.mock('uniswap/src/constants/urls', () => ({
  getUniswapServiceUrls: (): { graphQLUrl: string } => ({
    graphQLUrl: 'https://analytics.example/v1/graphql',
  }),
}))

import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import type { JsonRpcProvider } from '@ethersproject/providers'
import { FeeAmount } from '@uniswap/v3-sdk'
import {
  MULTICALL3_ABI,
  V3_FACTORY_ABI,
  V3_POOL_STATE_ABI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_EURE_V1,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_GNO,
  GNOSIS_MULTICALL3_ADDRESS,
  GNOSIS_SDAI,
  GNOSIS_USDCE,
  GNOSIS_V3_FACTORY_ADDRESS,
  GNOSIS_WETH,
  GNOSIS_WSTETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  buildGnosisPoolDiscoveryCandidates,
  clearGnosisPoolDiscoveryCache,
  discoverGnosisPoolGraphEdges,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolDiscovery'
import { clearGnosisPoolTvlCache } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolTvl'
import { normalizeGnosisRouteTokenAddress } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/routeCandidates'

const TOKEN_A = '0x1000000000000000000000000000000000000001'
const TOKEN_B = '0x2000000000000000000000000000000000000002'

function lower(address: string): string {
  return normalizeGnosisRouteTokenAddress(address)
}

describe('Gnosis pool discovery', () => {
  it('uses the intended Gnosis routing hubs', () => {
    expect(GNOSIS_BASE_TOKENS.map(lower)).toEqual([
      lower(GNOSIS_USDCE),
      lower(GNOSIS_WXDAI),
      lower(GNOSIS_SDAI),
      lower(GNOSIS_EURE_V2),
      lower(GNOSIS_WSTETH),
      lower(GNOSIS_GNO),
      lower(GNOSIS_WETH),
    ])
  })

  it('does not route through legacy Monerium aliases or GBPe by default', () => {
    const routingHubs = GNOSIS_BASE_TOKENS.map(lower)
    expect(routingHubs).not.toContain(lower(GNOSIS_EURE_V1))
    expect(routingHubs).not.toContain(lower(GNOSIS_GBPE_V1))
    expect(routingHubs).not.toContain(lower(GNOSIS_GBPE_V2))
  })

  it('builds unique token-pair and fee-tier discovery candidates', () => {
    const candidates = buildGnosisPoolDiscoveryCandidates({
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      routingHubs: [GNOSIS_USDCE, GNOSIS_USDCE],
      feeTiers: [FeeAmount.LOW, FeeAmount.MEDIUM],
    })

    expect(candidates).toEqual([
      { tokenA: lower(TOKEN_A), tokenB: lower(TOKEN_B), fee: FeeAmount.LOW },
      { tokenA: lower(TOKEN_A), tokenB: lower(TOKEN_B), fee: FeeAmount.MEDIUM },
      { tokenA: lower(TOKEN_A), tokenB: lower(GNOSIS_USDCE), fee: FeeAmount.LOW },
      { tokenA: lower(TOKEN_A), tokenB: lower(GNOSIS_USDCE), fee: FeeAmount.MEDIUM },
      { tokenA: lower(TOKEN_B), tokenB: lower(GNOSIS_USDCE), fee: FeeAmount.LOW },
      { tokenA: lower(TOKEN_B), tokenB: lower(GNOSIS_USDCE), fee: FeeAmount.MEDIUM },
    ])
  })

  it('discovers legacy shared-state pools for canonical Monerium endpoints', () => {
    const candidates = buildGnosisPoolDiscoveryCandidates({
      tokenIn: TOKEN_A,
      tokenOut: GNOSIS_GBPE_V2,
      routingHubs: [],
      feeTiers: [FeeAmount.LOW],
    })

    expect(candidates).toEqual(
      expect.arrayContaining([
        { tokenA: lower(TOKEN_A), tokenB: lower(GNOSIS_GBPE_V2), fee: FeeAmount.LOW },
        { tokenA: lower(TOKEN_A), tokenB: lower(GNOSIS_GBPE_V1), fee: FeeAmount.LOW },
      ]),
    )
  })
})

describe('Gnosis pool graph discovery via the analytics adapter', () => {
  const multicallInterface = new Interface(MULTICALL3_ABI)
  const factoryInterface = new Interface(V3_FACTORY_ABI)
  const poolStateInterface = new Interface(V3_POOL_STATE_ABI)

  const SQRT_PRICE_ONE = BigNumber.from(2).pow(96)
  const POOL_LIQUIDITY = '1000000000000000000000'

  const HUB_HUB_POOL = '0x00000000000000000000000000000000000000f1'
  const ENDPOINT_POOL = '0x00000000000000000000000000000000000000f2'

  const mockFetch = vi.fn()
  global.fetch = mockFetch as unknown as typeof fetch

  function graphQlResponse(data: unknown): Response {
    return { ok: true, json: vi.fn().mockResolvedValue(data) } as unknown as Response
  }

  function topPool(args: { address: string; tokenA: string; tokenB: string; tvlUSD: number }): Record<string, unknown> {
    return {
      address: args.address,
      feeTier: FeeAmount.LOW,
      totalLiquidity: { value: args.tvlUSD },
      token0: { address: lower(args.tokenA), symbol: 'T0', decimals: 18 },
      token1: { address: lower(args.tokenB), symbol: 'T1', decimals: 18 },
    }
  }

  function pairKey(tokenA: string, tokenB: string): string {
    const a = lower(tokenA)
    const b = lower(tokenB)
    return a < b ? `${a}:${b}` : `${b}:${a}`
  }

  /**
   * Provider whose only surface is Multicall3.aggregate3. Factory getPool answers from
   * `factoryPools` (keyed by unordered token pair, LOW fee only) and records every probed pair;
   * slot0/liquidity return synthetic in-range state for any pool address.
   */
  function makeDiscoveryProvider(factoryPools: Record<string, string>): {
    provider: JsonRpcProvider
    probedPairs: string[]
  } {
    const probedPairs: string[] = []
    const call = vi.fn(async (tx: { to: string; data: string }): Promise<string> => {
      if (tx.to.toLowerCase() !== GNOSIS_MULTICALL3_ADDRESS.toLowerCase()) {
        throw new Error(`Unexpected non-multicall eth_call to ${tx.to}`)
      }
      const [calls] = multicallInterface.decodeFunctionData('aggregate3', tx.data) as [
        { target: string; callData: string }[],
      ]
      const results = calls.map(({ target, callData }) => {
        const selector = callData.slice(0, 10)
        if (target.toLowerCase() === GNOSIS_V3_FACTORY_ADDRESS.toLowerCase()) {
          const [tokenA, tokenB] = factoryInterface.decodeFunctionData('getPool', callData)
          probedPairs.push(pairKey(tokenA, tokenB))
          const pool = factoryPools[pairKey(tokenA, tokenB)]
          return {
            success: true,
            returnData: factoryInterface.encodeFunctionResult('getPool', [
              pool ?? '0x0000000000000000000000000000000000000000',
            ]),
          }
        }
        if (selector === poolStateInterface.getSighash('slot0')) {
          return {
            success: true,
            returnData: poolStateInterface.encodeFunctionResult('slot0', [SQRT_PRICE_ONE, 0, 0, 1, 1, 0, true]),
          }
        }
        if (selector === poolStateInterface.getSighash('liquidity')) {
          return {
            success: true,
            returnData: poolStateInterface.encodeFunctionResult('liquidity', [POOL_LIQUIDITY]),
          }
        }
        return { success: false, returnData: '0x' }
      })
      return multicallInterface.encodeFunctionResult('aggregate3', [results])
    })

    return {
      provider: { _isProvider: true, call } as unknown as JsonRpcProvider,
      probedPairs,
    }
  }

  beforeEach(() => {
    clearGnosisPoolDiscoveryCache()
    clearGnosisPoolTvlCache()
    mockFetch.mockReset()
  })

  it('builds the graph from the adapter pool list, probing the factory only for endpoint pairs', async () => {
    // Adapter knows the hub-hub pool (USDC.e/WXDAI); the factory additionally knows a tokenIn pool
    // (TOKEN_A/USDC.e) the adapter has not indexed yet.
    mockFetch.mockResolvedValueOnce(
      graphQlResponse({
        data: {
          topV3Pools: [topPool({ address: HUB_HUB_POOL, tokenA: GNOSIS_USDCE, tokenB: GNOSIS_WXDAI, tvlUSD: 50_000 })],
        },
      }),
    )
    const { provider, probedPairs } = makeDiscoveryProvider({
      [pairKey(TOKEN_A, GNOSIS_USDCE)]: ENDPOINT_POOL,
    })

    const edges = await discoverGnosisPoolGraphEdges({
      provider,
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      routingHubs: [GNOSIS_USDCE, GNOSIS_WXDAI],
      feeTiers: [FeeAmount.LOW],
    })

    // The hub-hub pool comes from the adapter (TVL attached, never factory-probed); the union
    // probe still finds the unindexed tokenIn pool on-chain (no TVL).
    expect(probedPairs).not.toContain(pairKey(GNOSIS_USDCE, GNOSIS_WXDAI))
    expect(probedPairs).toContain(pairKey(TOKEN_A, GNOSIS_USDCE))
    const edgesByPool = new Map(edges.map((edge) => [edge.poolAddress?.toLowerCase(), edge]))
    expect(edgesByPool.get(HUB_HUB_POOL)).toEqual(
      expect.objectContaining({ tvlUSD: 50_000, initialized: true, liquidity: BigNumber.from(POOL_LIQUIDITY) }),
    )
    expect(edgesByPool.get(ENDPOINT_POOL)).toEqual(expect.objectContaining({ tvlUSD: undefined, initialized: true }))
    expect(edges).toHaveLength(2)
  })

  it('falls back to full factory probing when the adapter fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('adapter unavailable'))
    const { provider, probedPairs } = makeDiscoveryProvider({
      [pairKey(GNOSIS_USDCE, GNOSIS_WXDAI)]: HUB_HUB_POOL,
    })

    const edges = await discoverGnosisPoolGraphEdges({
      provider,
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      routingHubs: [GNOSIS_USDCE, GNOSIS_WXDAI],
      feeTiers: [FeeAmount.LOW],
    })

    // Full pair matrix, hub-hub pairs included — identical to pre-adapter discovery.
    expect(probedPairs).toContain(pairKey(GNOSIS_USDCE, GNOSIS_WXDAI))
    expect(edges).toEqual([
      expect.objectContaining({ poolAddress: HUB_HUB_POOL, tvlUSD: undefined, initialized: true }),
    ])
  })
})
