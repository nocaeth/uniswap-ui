import type { Pool } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { areEvmAddressesEqual } from 'uniswap/src/utils/addresses'

export function selectPoolById(pools: readonly Pool[] | undefined, poolId?: string): Pool | undefined {
  if (!pools?.length) {
    return undefined
  }

  if (!poolId) {
    return pools[0]
  }

  return pools.find((pool) => areEvmAddressesEqual(pool.poolId, poolId))
}
