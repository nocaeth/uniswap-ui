import { contenthashToUri } from '~/lib/utils/contenthashToUri'

// this test is skipped for now because importing CID results in
// TypeError: TextDecoder is not a constructor

describe('#contenthashToUri', () => {
  it('1inch.tokens.eth contenthash', () => {
    expect(contenthashToUri('0xe3010170122013e051d1cfff20606de36845d4fe28deb9861a319a5bc8596fa4e610e8803918')).toEqual(
      'ipfs://QmPgEqyV3m8SB52BS2j2mJpu9zGprhj2BGCHtRiiw2fdM1',
    )
  })
  it('noca.eth contenthash', () => {
    expect(contenthashToUri('0xe5010170000c737761702e676e6f2e6e6f77')).toEqual('ipns://swap.gno.now')
  })
})
