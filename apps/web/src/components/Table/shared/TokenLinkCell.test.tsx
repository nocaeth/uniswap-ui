import { GraphQLApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { TestID } from 'uniswap/src/test/fixtures/testIDs'
import { TokenLinkCell } from '~/components/Table/shared/TokenLinkCell'
import { validBEPoolToken0 } from '~/test-utils/pools/fixtures'
import { render, screen } from '~/test-utils/render'

describe('TokenLinkCell', () => {
  it('renders unknown token', () => {
    const { asFragment } = render(<TokenLinkCell token={{ ...validBEPoolToken0, symbol: undefined }} />)
    expect(screen.getByText('UNKNOWN')).toBeDefined()
    expect(asFragment()).toMatchSnapshot()
  })

  it('renders known token on mainnet', () => {
    const { asFragment } = render(<TokenLinkCell token={validBEPoolToken0} />)
    expect(screen.getByText('USDC')).toBeDefined()
    expect(asFragment()).toMatchSnapshot()
  })

  it('renders known token on a different chain', () => {
    const { asFragment } = render(<TokenLinkCell token={{ ...validBEPoolToken0, chain: GraphQLApi.Chain.Polygon }} />)
    const networkLogo = screen.getByTestId(`${TestID.NetworkLogoPrefix}${UniverseChainId.Polygon}`)
    expect(networkLogo.querySelector('img')).toHaveAttribute('src', expect.stringContaining('polygon-logo.png'))
    expect(asFragment()).toMatchSnapshot()
  })

  it('uses the NOCA token-list logo for Gnosis tokens', () => {
    const token = {
      ...validBEPoolToken0,
      address: '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6',
      chain: 'GNOSIS',
      symbol: 'wstETH',
      name: 'Bridged Wrapped stETH',
      project: {
        ...validBEPoolToken0.project,
        logo: {
          ...validBEPoolToken0.project?.logo,
          url: 'https://example.com/backend-wsteth.png',
        },
      },
    } as unknown as GraphQLApi.Token

    render(<TokenLinkCell token={token} />)

    expect(screen.getByTestId('img-token-image').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('githubusercontent.com/nocaeth/gc-tokenlist'),
    )
  })
})
