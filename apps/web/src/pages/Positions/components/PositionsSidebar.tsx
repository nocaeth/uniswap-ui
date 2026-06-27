import { Flex } from 'ui/src'
import type { UniverseChainId } from 'uniswap/src/features/chains/types'
import { TopPools } from '~/pages/Positions/TopPools'

interface PositionsSidebarProps {
  chainFilter: UniverseChainId | null
}

export function PositionsSidebar({ chainFilter }: PositionsSidebarProps) {
  return (
    <Flex gap="$gap32">
      <TopPools chainId={chainFilter} />
    </Flex>
  )
}
