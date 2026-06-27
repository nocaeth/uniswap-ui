import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

export const GNOSIS_EURE_CANONICAL_ADDRESS = '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430'
export const GNOSIS_EURE_LEGACY_ADDRESS = '0xcB444e90D8198415266c6a2724b7900fb12FC56E'

export const GNOSIS_GBPE_CANONICAL_ADDRESS = '0x8E34bfEC4f6Eb781f9743D9b4af99CD23F9b7053'
export const GNOSIS_GBPE_LEGACY_ADDRESSES = ['0x5Cb9073902F2035222B9749F8fB0c9BFe5527108'] as const

type GnosisDiscoveryCanonicalToken = {
  readonly symbol: 'EURe' | 'GBPe'
  readonly name: string
  readonly decimals: number
  readonly canonicalAddress: string
  readonly legacyAddresses: readonly string[]
}

export const GNOSIS_DISCOVERY_CANONICAL_TOKENS = [
  {
    symbol: 'EURe',
    name: 'Monerium EUR emoney',
    decimals: 18,
    canonicalAddress: GNOSIS_EURE_CANONICAL_ADDRESS,
    legacyAddresses: [GNOSIS_EURE_LEGACY_ADDRESS],
  },
  {
    symbol: 'GBPe',
    name: 'Monerium GBP emoney',
    decimals: 18,
    canonicalAddress: GNOSIS_GBPE_CANONICAL_ADDRESS,
    legacyAddresses: GNOSIS_GBPE_LEGACY_ADDRESSES,
  },
] as const satisfies readonly GnosisDiscoveryCanonicalToken[]

function isSameGnosisAddress(addressA: string, addressB: string): boolean {
  return areAddressesEqual({
    addressInput1: { address: addressA, chainId: UniverseChainId.Gnosis },
    addressInput2: { address: addressB, chainId: UniverseChainId.Gnosis },
  })
}

export function getGnosisDiscoveryCanonicalToken({
  chainId,
  address,
}: {
  chainId?: number | null
  address?: string | null
}): GnosisDiscoveryCanonicalToken | undefined {
  if (chainId !== UniverseChainId.Gnosis || !address) {
    return undefined
  }

  const trimmedAddress = address.trim()
  return GNOSIS_DISCOVERY_CANONICAL_TOKENS.find(
    (token) =>
      isSameGnosisAddress(trimmedAddress, token.canonicalAddress) ||
      token.legacyAddresses.some((legacyAddress) => isSameGnosisAddress(trimmedAddress, legacyAddress)),
  )
}

export function canonicalizeGnosisDiscoveryTokenAddress({
  chainId,
  address,
}: {
  chainId?: number | null
  address: string
}): string {
  return getGnosisDiscoveryCanonicalToken({ chainId, address })?.canonicalAddress ?? address
}

export function isLegacyGnosisDiscoveryTokenAddress({
  chainId,
  address,
}: {
  chainId?: number | null
  address?: string | null
}): boolean {
  if (chainId !== UniverseChainId.Gnosis || !address) {
    return false
  }

  const trimmedAddress = address.trim()
  return GNOSIS_DISCOVERY_CANONICAL_TOKENS.some((token) =>
    token.legacyAddresses.some((legacyAddress) => isSameGnosisAddress(trimmedAddress, legacyAddress)),
  )
}

export function canonicalizeGnosisDiscoverySearchQuery({
  chainIds,
  searchQuery,
}: {
  chainIds: readonly number[]
  searchQuery: string | null | undefined
}): string | undefined {
  if (!searchQuery) {
    return undefined
  }

  if (chainIds.length !== 1 || chainIds[0] !== UniverseChainId.Gnosis) {
    return searchQuery
  }

  return canonicalizeGnosisDiscoveryTokenAddress({
    chainId: UniverseChainId.Gnosis,
    address: searchQuery,
  })
}
