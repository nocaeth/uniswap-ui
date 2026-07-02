import { FeeAmount } from '@uniswap/v3-sdk'
import {
  GNOSIS_BASE_TOKENS,
  GNOSIS_EURE_V1,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_GNO,
  GNOSIS_SDAI,
  GNOSIS_USDCE,
  GNOSIS_WETH,
  GNOSIS_WSTETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { buildGnosisPoolDiscoveryCandidates } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/poolDiscovery'
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
