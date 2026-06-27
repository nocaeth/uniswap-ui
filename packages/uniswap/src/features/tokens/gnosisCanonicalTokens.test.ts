import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  canonicalizeGnosisDiscoverySearchQuery,
  canonicalizeGnosisDiscoveryTokenAddress,
  GNOSIS_EURE_CANONICAL_ADDRESS,
  GNOSIS_EURE_LEGACY_ADDRESS,
  GNOSIS_GBPE_CANONICAL_ADDRESS,
  GNOSIS_GBPE_LEGACY_ADDRESSES,
  getGnosisSharedStateTokenAddresses,
  isLegacyGnosisDiscoveryTokenAddress,
} from 'uniswap/src/features/tokens/gnosisCanonicalTokens'

describe('gnosisCanonicalTokens', () => {
  it('canonicalizes legacy EURe to EURe v2 for discovery', () => {
    expect(
      canonicalizeGnosisDiscoveryTokenAddress({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_EURE_LEGACY_ADDRESS,
      }),
    ).toBe(GNOSIS_EURE_CANONICAL_ADDRESS)
  })

  it('canonicalizes legacy GBPe to GBPe v2 for discovery', () => {
    expect(
      canonicalizeGnosisDiscoveryTokenAddress({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_GBPE_LEGACY_ADDRESSES[0],
      }),
    ).toBe(GNOSIS_GBPE_CANONICAL_ADDRESS)
  })

  it('does not canonicalize aliases on non-Gnosis chains', () => {
    expect(
      canonicalizeGnosisDiscoveryTokenAddress({
        chainId: UniverseChainId.Mainnet,
        address: GNOSIS_EURE_LEGACY_ADDRESS,
      }),
    ).toBe(GNOSIS_EURE_LEGACY_ADDRESS)
  })

  it('identifies legacy discovery addresses without marking canonical addresses legacy', () => {
    expect(
      isLegacyGnosisDiscoveryTokenAddress({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_EURE_LEGACY_ADDRESS,
      }),
    ).toBe(true)
    expect(
      isLegacyGnosisDiscoveryTokenAddress({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_GBPE_LEGACY_ADDRESSES[0],
      }),
    ).toBe(true)
    expect(
      isLegacyGnosisDiscoveryTokenAddress({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_GBPE_CANONICAL_ADDRESS,
      }),
    ).toBe(false)
  })

  it('canonicalizes pasted legacy addresses only when search is scoped to Gnosis', () => {
    expect(
      canonicalizeGnosisDiscoverySearchQuery({
        chainIds: [UniverseChainId.Gnosis],
        searchQuery: GNOSIS_GBPE_LEGACY_ADDRESSES[0],
      }),
    ).toBe(GNOSIS_GBPE_CANONICAL_ADDRESS)
    expect(
      canonicalizeGnosisDiscoverySearchQuery({
        chainIds: [UniverseChainId.Mainnet, UniverseChainId.Gnosis],
        searchQuery: GNOSIS_GBPE_LEGACY_ADDRESSES[0],
      }),
    ).toBe(GNOSIS_GBPE_LEGACY_ADDRESSES[0])
  })

  it('returns canonical and legacy shared-state addresses with the requested address first', () => {
    expect(
      getGnosisSharedStateTokenAddresses({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_GBPE_CANONICAL_ADDRESS,
      }),
    ).toEqual([GNOSIS_GBPE_CANONICAL_ADDRESS, GNOSIS_GBPE_LEGACY_ADDRESSES[0]])
    expect(
      getGnosisSharedStateTokenAddresses({
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_GBPE_LEGACY_ADDRESSES[0],
      }),
    ).toEqual([GNOSIS_GBPE_LEGACY_ADDRESSES[0], GNOSIS_GBPE_CANONICAL_ADDRESS])
  })
})
