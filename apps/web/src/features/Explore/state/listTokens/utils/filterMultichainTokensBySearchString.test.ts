import { normalizeTokenAddressForCache } from 'uniswap/src/data/cache'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_GBPE_CANONICAL_ADDRESS,
  GNOSIS_GBPE_LEGACY_ADDRESSES,
} from 'uniswap/src/features/tokens/gnosisCanonicalTokens'
import { createDataApiMultichainToken } from 'uniswap/src/test/fixtures/dataApi/multichainToken'
import { describe, expect, it, vi } from 'vitest'
import { filterMultichainTokensBySearchString } from '~/features/Explore/state/listTokens/utils/filterMultichainTokensBySearchString'

vi.mock('uniswap/src/data/cache', () => ({
  normalizeTokenAddressForCache: vi.fn((addr: string | null) =>
    addr === null ? null : addr.replace(/[A-F]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32)),
  ),
}))

const mockNormalize = vi.mocked(normalizeTokenAddressForCache)
const normalizeHexForTest = (addr: string | null): string | null =>
  addr === null ? null : addr.replace(/[A-F]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32))

describe('filterMultichainTokensBySearchString', () => {
  beforeEach(() => {
    mockNormalize.mockImplementation(normalizeHexForTest)
  })

  it('should return tokens unchanged when filterString is empty', () => {
    const tokens = [createDataApiMultichainToken({ symbol: 'USDC' }), createDataApiMultichainToken({ symbol: 'WETH' })]
    expect(filterMultichainTokensBySearchString(tokens, '')).toEqual(tokens)
    expect(filterMultichainTokensBySearchString(tokens, '')).toHaveLength(2)
  })

  it('should return tokens unchanged when filterString is empty string', () => {
    const tokens = [createDataApiMultichainToken()]
    expect(filterMultichainTokensBySearchString(tokens, '')).toBe(tokens)
  })

  it('should filter by name (case-insensitive)', () => {
    const tokens = [
      createDataApiMultichainToken({ name: 'USD Coin', symbol: 'USDC' }),
      createDataApiMultichainToken({ name: 'Wrapped Ether', symbol: 'WETH' }),
    ]
    const result = filterMultichainTokensBySearchString(tokens, 'usd coin')
    expect(result).toHaveLength(1)
    expect(result[0]?.symbol).toBe('USDC')
  })

  it('should filter by symbol (case-insensitive)', () => {
    const tokens = [createDataApiMultichainToken({ symbol: 'USDC' }), createDataApiMultichainToken({ symbol: 'WETH' })]
    const result = filterMultichainTokensBySearchString(tokens, 'weth')
    expect(result).toHaveLength(1)
    expect(result[0]?.symbol).toBe('WETH')
  })

  it('should filter by projectName (case-insensitive)', () => {
    const tokens = [
      createDataApiMultichainToken({ projectName: 'Circle', symbol: 'USDC' }),
      createDataApiMultichainToken({ projectName: 'Uniswap', symbol: 'UNI' }),
    ]
    const result = filterMultichainTokensBySearchString(tokens, 'circle')
    expect(result).toHaveLength(1)
    expect(result[0]?.symbol).toBe('USDC')
  })

  it('should filter by multichainId (case-insensitive)', () => {
    const tokens = [
      createDataApiMultichainToken({ multichainId: 'mc:1_0xABC', symbol: 'A' }),
      createDataApiMultichainToken({
        multichainId: 'mc:8453_0xDEF',
        symbol: 'B',
      }),
    ]
    const result = filterMultichainTokensBySearchString(tokens, '0xdef')
    expect(result).toHaveLength(1)
    expect(result[0]?.symbol).toBe('B')
  })

  it('should filter by chain token address using normalizeTokenAddressForCache', () => {
    mockNormalize.mockImplementation(normalizeHexForTest)
    const tokens = [
      createDataApiMultichainToken({
        multichainId: 'mc:1_0xUSDC',
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        symbol: 'USDC',
      }),
      createDataApiMultichainToken({
        multichainId: 'mc:1_0xDef',
        address: '0xDef',
        symbol: 'OTHER',
      }),
    ]
    const result = filterMultichainTokensBySearchString(tokens, '0xa0b869')
    expect(result).toHaveLength(1)
    expect(result[0]?.symbol).toBe('USDC')
    expect(mockNormalize).toHaveBeenCalledWith('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  })

  it('should exclude token when no field matches', () => {
    const tokens = [
      createDataApiMultichainToken({
        name: 'USD Coin',
        symbol: 'USDC',
        projectName: 'Circle',
      }),
    ]
    const result = filterMultichainTokensBySearchString(tokens, 'xyz')
    expect(result).toHaveLength(0)
  })

  it('should include token when any field matches', () => {
    const token = createDataApiMultichainToken({
      name: 'Unique Name',
      symbol: 'SYM',
      projectName: 'Project',
      multichainId: 'mc:1_0xAddr',
      address: '0xAddr',
    })
    expect(filterMultichainTokensBySearchString([token], 'unique')).toHaveLength(1)
    expect(filterMultichainTokensBySearchString([token], 'sym')).toHaveLength(1)
    expect(filterMultichainTokensBySearchString([token], 'project')).toHaveLength(1)
    expect(filterMultichainTokensBySearchString([token], '0xaddr')).toHaveLength(1)
  })

  it('should return empty array when no tokens match', () => {
    const tokens = [createDataApiMultichainToken({ symbol: 'A' }), createDataApiMultichainToken({ symbol: 'B' })]
    expect(filterMultichainTokensBySearchString(tokens, 'nonexistent')).toEqual([])
  })

  it('should match canonical GBPe when filtering by the legacy GBPe address', () => {
    const tokens = [
      createDataApiMultichainToken({
        multichainId: 'mc:canonical-gbpe',
        chainId: UniverseChainId.Gnosis,
        address: GNOSIS_GBPE_CANONICAL_ADDRESS,
        symbol: 'GBPe',
        name: 'Monerium GBP emoney',
      }),
    ]

    const result = filterMultichainTokensBySearchString(tokens, GNOSIS_GBPE_LEGACY_ADDRESSES[0])

    expect(result).toHaveLength(1)
    expect(result[0]?.chainTokens[0]?.address).toBe(GNOSIS_GBPE_CANONICAL_ADDRESS)
  })
})
