import { GraphQLApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { createTDPStore, type TDPState } from '~/pages/TokenDetails/context/createTDPStore'
import { syncTDPStoreState, type TDPIdentity } from '~/pages/TokenDetails/context/TDPStoreContextProvider'
import { validTokenProjectResponse } from '~/test-utils/tokens/fixtures'

const TOKEN_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const TOKEN_B = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const IDENTITY_A: TDPIdentity = { tokenAddress: TOKEN_A, chainName: 'ethereum' }
const IDENTITY_B: TDPIdentity = { tokenAddress: TOKEN_B, chainName: 'ethereum' }

function createDerivedState(overrides: {
  address: string
  tokenQuery?: { loading: boolean; data?: unknown }
  tokenColor?: string
  balanceError?: Error
}): TDPState {
  return {
    currencyChain: GraphQLApi.Chain.Ethereum,
    currencyChainId: UniverseChainId.Mainnet,
    address: overrides.address,
    tokenQuery: overrides.tokenQuery ?? {
      loading: false,
      data: validTokenProjectResponse.data,
    },
    multiChainMap: {},
    balanceError: overrides.balanceError,
    selectedMultichainChainId: undefined,
    tokenColor: overrides.tokenColor,
    currency: undefined,
  } as unknown as TDPState
}

describe('syncTDPStoreState', () => {
  it('replaces full store state when identity changes', () => {
    const store = createTDPStore(createDerivedState({ address: TOKEN_A }))

    const nextIdentity = syncTDPStoreState({
      store,
      derivedState: createDerivedState({ address: TOKEN_B }),
      identity: IDENTITY_B,
      previousIdentity: IDENTITY_A,
      hasDerivedStateChanged: false,
    })

    expect(store.getState().address).toBe(TOKEN_B)
    expect(nextIdentity).toEqual(IDENTITY_B)
  })

  it('applies partial updates when identity is unchanged but derived state changes', () => {
    const initialTokenQuery = { loading: false, data: validTokenProjectResponse.data }
    const updatedTokenQuery = { loading: false, data: { ...validTokenProjectResponse.data } }
    const store = createTDPStore(createDerivedState({ address: TOKEN_A, tokenQuery: initialTokenQuery }))

    const nextIdentity = syncTDPStoreState({
      store,
      derivedState: createDerivedState({ address: TOKEN_A, tokenQuery: updatedTokenQuery }),
      identity: IDENTITY_A,
      previousIdentity: IDENTITY_A,
      hasDerivedStateChanged: true,
    })

    expect(store.getState().address).toBe(TOKEN_A)
    expect(store.getState().tokenQuery).toEqual(updatedTokenQuery)
    expect(nextIdentity).toEqual(IDENTITY_A)
  })

  it('updates tokenColor when only tokenColor changes for the same identity', () => {
    const store = createTDPStore(createDerivedState({ address: TOKEN_A, tokenColor: undefined }))

    syncTDPStoreState({
      store,
      derivedState: createDerivedState({ address: TOKEN_A, tokenColor: '#FF0000' }),
      identity: IDENTITY_A,
      previousIdentity: IDENTITY_A,
      hasDerivedStateChanged: true,
    })

    expect(store.getState().address).toBe(TOKEN_A)
    expect(store.getState().tokenColor).toBe('#FF0000')
  })

  it('updates the raw balance query error when identity is unchanged', () => {
    const store = createTDPStore(createDerivedState({ address: TOKEN_A, balanceError: undefined }))
    const balanceError = new Error('Network error')

    syncTDPStoreState({
      store,
      derivedState: createDerivedState({ address: TOKEN_A, balanceError }),
      identity: IDENTITY_A,
      previousIdentity: IDENTITY_A,
      hasDerivedStateChanged: true,
    })

    expect(store.getState().balanceError).toBe(balanceError)
  })
})
