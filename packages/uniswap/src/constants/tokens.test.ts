import { nativeOnChain } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

describe('nativeOnChain', () => {
  it('wraps Gnosis native XDAI to WXDAI', () => {
    const wrapped = nativeOnChain(UniverseChainId.Gnosis).wrapped

    expect(
      areAddressesEqual({
        addressInput1: { address: wrapped.address, chainId: UniverseChainId.Gnosis },
        addressInput2: { address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', chainId: UniverseChainId.Gnosis },
      }),
    ).toBe(true)
    expect(wrapped.symbol).toBe('WXDAI')
  })
})
