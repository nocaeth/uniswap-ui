import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { ExploreTab } from '~/types/explore'

export const POOL_DETAILS_NOT_FOUND_REDIRECT_PATH = `/explore/pools?type=${ExploreTab.Pools}&result=${ModalName.NotFound}`

export function getPoolDetailsNotFoundRedirectPath({
  poolAddress,
  hasChainInfo,
  poolLoading,
  hasPoolData,
}: {
  poolAddress?: string
  hasChainInfo: boolean
  poolLoading: boolean
  hasPoolData: boolean
}): string | undefined {
  const isInvalidPool = !poolAddress || !hasChainInfo
  const poolNotFound = (!poolLoading && !hasPoolData) || isInvalidPool

  return poolNotFound ? POOL_DETAILS_NOT_FOUND_REDIRECT_PATH : undefined
}
