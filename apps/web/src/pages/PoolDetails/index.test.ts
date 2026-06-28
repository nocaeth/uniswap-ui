import { getPoolDetailsNotFoundRedirectPath, POOL_DETAILS_NOT_FOUND_REDIRECT_PATH } from '~/pages/PoolDetails/redirect'

describe('getPoolDetailsNotFoundRedirectPath', () => {
  it('redirects when the pool address is missing', () => {
    expect(
      getPoolDetailsNotFoundRedirectPath({
        poolAddress: undefined,
        hasChainInfo: true,
        poolLoading: false,
        hasPoolData: true,
      }),
    ).toBe(POOL_DETAILS_NOT_FOUND_REDIRECT_PATH)
  })

  it('redirects when chain info is missing', () => {
    expect(
      getPoolDetailsNotFoundRedirectPath({
        poolAddress: '0xpool',
        hasChainInfo: false,
        poolLoading: false,
        hasPoolData: true,
      }),
    ).toBe(POOL_DETAILS_NOT_FOUND_REDIRECT_PATH)
  })

  it('redirects after loading completes without pool data', () => {
    expect(
      getPoolDetailsNotFoundRedirectPath({
        poolAddress: '0xpool',
        hasChainInfo: true,
        poolLoading: false,
        hasPoolData: false,
      }),
    ).toBe(POOL_DETAILS_NOT_FOUND_REDIRECT_PATH)
  })

  it('does not redirect while a valid pool is still loading', () => {
    expect(
      getPoolDetailsNotFoundRedirectPath({
        poolAddress: '0xpool',
        hasChainInfo: true,
        poolLoading: true,
        hasPoolData: false,
      }),
    ).toBeUndefined()
  })
})
