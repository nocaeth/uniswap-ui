import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { PositionsSidebar } from '~/pages/Positions/components/PositionsSidebar'
import { render, screen } from '~/test-utils/render'

vi.mock('~/pages/Positions/TopPools', () => ({
  TopPools: ({ chainId }: { chainId: UniverseChainId | null }) => (
    <div data-testid="top-pools-mock">{chainId === null ? 'all-chains' : `chain-${chainId}`}</div>
  ),
}))

describe('PositionsSidebar', () => {
  it('always renders TopPools with the provided chainFilter', () => {
    render(<PositionsSidebar chainFilter={UniverseChainId.Mainnet} />)

    expect(screen.getByTestId('top-pools-mock')).toHaveTextContent(`chain-${UniverseChainId.Mainnet}`)
  })

  it('renders TopPools with all-chains marker when chainFilter is null', () => {
    render(<PositionsSidebar chainFilter={null} />)

    expect(screen.getByTestId('top-pools-mock')).toHaveTextContent('all-chains')
  })

  it('does not render the Uniswap learn-more block', () => {
    render(<PositionsSidebar chainFilter={null} />)

    expect(screen.queryByText('Learn about liquidity provision')).not.toBeInTheDocument()
  })
})
