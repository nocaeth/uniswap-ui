import React from 'react'

type StateContext = boolean
type SetContext = (v: boolean) => void

const WebFORNudgeStateContext = React.createContext<StateContext>(false)
WebFORNudgeStateContext.displayName = 'WebFORNudgeStateContext'

const WebFORNudgeSetContext = React.createContext<SetContext>((_: boolean) => {})
WebFORNudgeSetContext.displayName = 'WebFORNudgeSetContext'

const WebFORNudgeEnabledContext = React.createContext<boolean>(false)
WebFORNudgeEnabledContext.displayName = 'WebFORNudgeEnabledContext'

// This is a provider to wrap the swap component to maintain the state across different swap tabs
export function WebFORNudgeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = React.useState(false)
  const isWebFORNudgeEnabled = useWebFORNudgeGateEnabled()

  return (
    <WebFORNudgeEnabledContext.Provider value={isWebFORNudgeEnabled}>
      <WebFORNudgeStateContext.Provider value={state}>
        <WebFORNudgeSetContext.Provider value={setState}>{children}</WebFORNudgeSetContext.Provider>
      </WebFORNudgeStateContext.Provider>
    </WebFORNudgeEnabledContext.Provider>
  )
}

export function useIsShowingWebFORNudge(): boolean {
  return React.useContext(WebFORNudgeStateContext)
}

export function useSetIsShowingWebFORNudge(): (v: boolean) => void {
  return React.useContext(WebFORNudgeSetContext)
}

export function useWebFORNudgeGateEnabled(): boolean {
  // Gnosis-only web builds do not expose fiat on-ramp flows, so the swap CTA must never open the FOR nudge.
  return false
}

export function useIsWebFORNudgeEnabled(): boolean {
  return React.useContext(WebFORNudgeEnabledContext)
}
