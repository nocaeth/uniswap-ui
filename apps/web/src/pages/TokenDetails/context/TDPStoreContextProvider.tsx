import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import { useHasValueChanged } from 'utilities/src/react/useHasValueChanged'
import { shallow } from 'zustand/shallow'
import { createTDPStore, type TDPState } from '~/pages/TokenDetails/context/createTDPStore'
import { TDPChainSearchParamSync } from '~/pages/TokenDetails/context/TDPChainSearchParamSync'
import { TDPStoreContext } from '~/pages/TokenDetails/context/TDPContext'
import { useCreateTDPContext } from '~/pages/TokenDetails/context/useCreateTDPContext'

interface TDPStoreContextProviderProps {
  children: ReactNode
}

export type TDPIdentity = { tokenAddress: string; chainName: string }

/** Identity for "same token page" so we can do partial updates when only data (e.g. tokenQuery) changes */
function useTDPIdentity(): TDPIdentity {
  const { tokenAddress, chainName } = useParams<{ tokenAddress: string; chainName: string }>()
  return { tokenAddress: tokenAddress ?? '', chainName: chainName ?? '' }
}

export function syncTDPStoreState({
  store,
  derivedState,
  identity,
  previousIdentity,
  hasDerivedStateChanged,
}: {
  store: ReturnType<typeof createTDPStore>
  derivedState: TDPState
  identity: TDPIdentity
  previousIdentity: TDPIdentity
  hasDerivedStateChanged: boolean
}): TDPIdentity {
  const isNewIdentity =
    previousIdentity.tokenAddress !== identity.tokenAddress || previousIdentity.chainName !== identity.chainName

  if (isNewIdentity) {
    store.setState({ ...derivedState })
    return { tokenAddress: identity.tokenAddress, chainName: identity.chainName }
  }

  if (!hasDerivedStateChanged) {
    return previousIdentity
  }

  const state = store.getState()
  const { actions } = state
  // Use Zustand shallow compare so we only update when top-level slice content changed
  if (!shallow(state.tokenQuery, derivedState.tokenQuery)) {
    actions.setTokenQuery(derivedState.tokenQuery)
  }
  if (!shallow(state.tokenProjectQuery, derivedState.tokenProjectQuery)) {
    actions.setTokenProjectQuery(derivedState.tokenProjectQuery)
  }
  if (!shallow(state.multiChainMap, derivedState.multiChainMap)) {
    actions.setMultiChainMap(derivedState.multiChainMap)
  }
  if (state.tokenColor !== derivedState.tokenColor) {
    actions.setTokenColor(derivedState.tokenColor)
  }
  if (!shallow(state.currency, derivedState.currency)) {
    actions.setCurrency(derivedState.currency)
  }
  if (state.address !== derivedState.address) {
    actions.setAddress(derivedState.address)
  }
  if (state.balanceError !== derivedState.balanceError) {
    actions.setBalanceError(derivedState.balanceError)
  }

  return previousIdentity
}

export function TDPStoreContextProvider({ children }: TDPStoreContextProviderProps): JSX.Element {
  const derivedState = useCreateTDPContext()
  const [store] = useState(() => createTDPStore(derivedState))
  const identity = useTDPIdentity()
  const prevIdentityRef = useRef(identity)

  const hasDerivedStateChanged = useHasValueChanged(derivedState)

  useEffect(() => {
    const currentIdentity = { tokenAddress: identity.tokenAddress, chainName: identity.chainName }
    prevIdentityRef.current = syncTDPStoreState({
      store,
      derivedState,
      identity: currentIdentity,
      previousIdentity: prevIdentityRef.current,
      hasDerivedStateChanged,
    })
  }, [derivedState, hasDerivedStateChanged, store, identity.tokenAddress, identity.chainName])

  useEffect(() => {
    return () => {
      const storeWithDevtools = store as { devtools?: { cleanup: () => void } }
      storeWithDevtools.devtools?.cleanup()
    }
  }, [store])

  return (
    <TDPStoreContext.Provider value={store}>
      <TDPChainSearchParamSync />
      {children}
    </TDPStoreContext.Provider>
  )
}
