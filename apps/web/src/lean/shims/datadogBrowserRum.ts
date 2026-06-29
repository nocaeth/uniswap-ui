export type RumEvent = {
  type?: string
  view?: { url: string }
  error?: { source?: string; message: string; stack?: string }
  resource?: { url: string }
  context?: Record<string, unknown>
}

export type RumEventDomainContext = Record<string, unknown>

export type RumFetchResourceEventDomainContext = {
  requestInit?: {
    body?: BodyInit | null
    headers?: HeadersInit
  }
}

const noop = (): void => undefined

export const datadogRum = {
  init: noop,
  addAction: noop,
  addError: noop,
  setUser: noop,
  setUserProperty: noop,
  setGlobalContextProperty: noop,
  addFeatureFlagEvaluation: noop,
  getInternalContext: (): undefined => undefined,
}
