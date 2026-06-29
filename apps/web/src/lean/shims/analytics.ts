export type UserPropertyValue = number | string | boolean | Array<string | number>

export interface TestnetModeConfig {
  aggregateEventName: string
  passthroughAllowlistEvents: string[]
  allowlistEvents: string[]
}

export type AnalyticsInitConfig = {
  transportProvider?: unknown
  allowed: boolean
  initHash?: string
  userIdGetter?: () => Promise<string>
  debugBridge?: unknown
}

export interface Analytics {
  init(config: AnalyticsInitConfig): Promise<void>
  setAllowAnalytics(allowed: boolean): Promise<void>
  setTestnetMode(enabled: boolean, config: TestnetModeConfig): void
  sendEvent(eventName: string, eventProperties?: Record<string, unknown>): void
  flushEvents(): void
  setUserProperty(property: string, value: UserPropertyValue, insert?: boolean): void
}

export async function getAnalyticsAtomDirect(): Promise<boolean> {
  return false
}

export const analytics: Analytics = {
  async init(): Promise<void> {
    return
  },
  async setAllowAnalytics(): Promise<void> {
    return
  },
  setTestnetMode(): void {
    return
  },
  sendEvent(): void {
    return
  },
  flushEvents(): void {
    return
  },
  setUserProperty(): void {
    return
  },
}
