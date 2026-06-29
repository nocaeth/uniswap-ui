import type {
  DynamicConfig,
  Experiment,
  FeatureGate,
  Layer,
  ParameterStore,
  PrecomputedEvaluationsContext,
  StatsigClientEventCallback,
  StatsigClientEventName,
  StatsigEvent,
  StatsigLoadingStatus,
  StatsigUpdateDetails,
  StatsigUser,
  TypedReturn,
} from '@statsig/client-core'
import type { StatsigOptions, StorageProvider } from '@statsig/react-bindings'
import { getPinnedWebFeatureFlagValue } from '@universe/gating/src/pinnedFeatureFlags'
import { createContext, createElement, type ReactElement, type ReactNode, useContext, useMemo } from 'react'

export type { StatsigOptions, StatsigUser, StorageProvider, TypedReturn }

const STATIC_SDK_KEY = 'static-web-statsig'
const STATIC_RULE_ID = 'static'
const STATIC_DETAILS = { reason: 'Static' }
const STATIC_UPDATE_DETAILS: StatsigUpdateDetails = {
  duration: 0,
  source: 'Bootstrap',
  success: true,
  error: null,
  sourceUrl: null,
}

const defaultUser: StatsigUser = {}

function typedDefault<T>(_key: string, fallback?: T): TypedReturn<T> {
  return fallback as TypedReturn<T>
}

function createEmptyConfig(name: string): DynamicConfig {
  return {
    name,
    value: {},
    ruleID: STATIC_RULE_ID,
    details: STATIC_DETAILS,
    __evaluation: null,
    get: typedDefault,
  }
}

function createEmptyExperiment(name: string): Experiment {
  return {
    ...createEmptyConfig(name),
    groupName: null,
  }
}

function createEmptyLayer(name: string): Layer {
  return {
    name,
    ruleID: STATIC_RULE_ID,
    details: STATIC_DETAILS,
    groupName: null,
    __value: {},
    __evaluation: null,
    get: typedDefault,
  }
}

function createEmptyParameterStore(name: string): ParameterStore {
  return {
    name,
    details: STATIC_DETAILS,
    __configuration: null,
    get: typedDefault,
  }
}

class StaticOverrideAdapter {
  private gate: Record<string, boolean> = {}
  private dynamicConfig: Record<string, Record<string, unknown>> = {}
  private layer: Record<string, Record<string, unknown>> = {}

  getAllOverrides(): {
    dynamicConfig: Record<string, Record<string, unknown>>
    gate: Record<string, boolean>
    layer: Record<string, Record<string, unknown>>
  } {
    return {
      gate: this.gate,
      dynamicConfig: this.dynamicConfig,
      layer: this.layer,
    }
  }

  overrideGate(name: string, value: boolean): void {
    this.gate[name] = value
  }

  removeGateOverride(name: string): void {
    delete this.gate[name]
  }

  overrideDynamicConfig(name: string, value: Record<string, unknown>): void {
    this.dynamicConfig[name] = value
  }

  removeDynamicConfigOverride(name: string): void {
    delete this.dynamicConfig[name]
  }

  overrideExperiment(name: string, value: Record<string, unknown>): void {
    this.dynamicConfig[name] = value
  }

  removeExperimentOverride(name: string): void {
    delete this.dynamicConfig[name]
  }

  overrideLayer(name: string, value: Record<string, unknown>): void {
    this.layer[name] = value
  }

  removeLayerOverride(name: string): void {
    delete this.layer[name]
  }

  removeAllOverrides(): void {
    this.gate = {}
    this.dynamicConfig = {}
    this.layer = {}
  }
}

const overrideAdapter = new StaticOverrideAdapter()

export class StatsigClient {
  static instance(): StatsigClient {
    return staticClient
  }

  readonly loadingStatus: StatsigLoadingStatus = 'Ready'
  private readonly sdkKey: string
  private readonly options: StatsigOptions | null
  private user: StatsigUser
  private readonly listeners = new Map<
    StatsigClientEventName,
    Set<StatsigClientEventCallback<StatsigClientEventName>>
  >()

  constructor(...args: [sdkKey?: string, user?: StatsigUser, options?: StatsigOptions | null]) {
    const [sdkKey = STATIC_SDK_KEY, user = defaultUser, options = null] = args
    this.sdkKey = sdkKey
    this.options = options
    this.user = user
  }

  initializeSync(): StatsigUpdateDetails {
    return STATIC_UPDATE_DETAILS
  }

  async initializeAsync(): Promise<StatsigUpdateDetails> {
    return STATIC_UPDATE_DETAILS
  }

  async shutdown(): Promise<void> {
    return
  }

  async flush(): Promise<void> {
    return
  }

  updateRuntimeOptions(): void {
    return
  }

  updateUserSync(user: StatsigUser): StatsigUpdateDetails {
    this.user = user
    return STATIC_UPDATE_DETAILS
  }

  async updateUserAsync(user: StatsigUser): Promise<StatsigUpdateDetails> {
    this.user = user
    return STATIC_UPDATE_DETAILS
  }

  getContext(): PrecomputedEvaluationsContext {
    return {
      sdkKey: this.sdkKey,
      options: this.options ?? {},
      errorBoundary: {} as PrecomputedEvaluationsContext['errorBoundary'],
      session: {} as PrecomputedEvaluationsContext['session'],
      stableID: this.user.customIDs?.stableID ?? '',
      values: null,
      user: this.user,
    }
  }

  checkGate(name: string): boolean {
    return getPinnedWebFeatureFlagValue(name) ?? false
  }

  getFeatureGate(name: string): FeatureGate {
    return {
      name,
      ruleID: STATIC_RULE_ID,
      details: STATIC_DETAILS,
      value: this.checkGate(name),
      __evaluation: null,
    }
  }

  getDynamicConfig(name: string): DynamicConfig {
    return createEmptyConfig(name)
  }

  getExperiment(name: string): Experiment {
    return createEmptyExperiment(name)
  }

  getLayer(name: string): Layer {
    return createEmptyLayer(name)
  }

  getParameterStore(name: string): ParameterStore {
    return createEmptyParameterStore(name)
  }

  logEvent(
    ..._args: [eventOrName: StatsigEvent | string, value?: string | number, metadata?: Record<string, string>]
  ): void {
    return
  }

  on<T extends StatsigClientEventName>(event: T, listener: StatsigClientEventCallback<T>): void {
    const listeners = this.listeners.get(event) ?? new Set<StatsigClientEventCallback<StatsigClientEventName>>()
    listeners.add(listener as unknown as StatsigClientEventCallback<StatsigClientEventName>)
    this.listeners.set(event, listeners)
  }

  off<T extends StatsigClientEventName>(event: T, listener: StatsigClientEventCallback<T>): void {
    this.listeners.get(event)?.delete(listener as unknown as StatsigClientEventCallback<StatsigClientEventName>)
  }

  $on<T extends StatsigClientEventName>(event: T, listener: StatsigClientEventCallback<T>): void {
    this.on(event, listener)
  }

  $emt(): void {
    return
  }
}

const staticClient = new StatsigClient()

type StaticStatsigContext = {
  readonly renderVersion: number
  readonly client: StatsigClient
}

export const StatsigContext = createContext<StaticStatsigContext>({
  renderVersion: 0,
  client: staticClient,
})

export function StatsigProvider({
  children,
  client = staticClient,
}: {
  children?: ReactNode
  client?: StatsigClient
}): ReactElement {
  const value = useMemo(() => ({ renderVersion: 0, client }), [client])
  return createElement(StatsigContext.Provider, { value }, children)
}

export const Storage = {
  isReady: (): boolean => true,
  isReadyResolver: (): null => null,
  getProviderName: (): string => 'StaticStatsigStorage',
  getItem: (): null => null,
  setItem: (): void => undefined,
  removeItem: (): void => undefined,
  getAllKeys: (): readonly string[] => [],
  _setProvider: (_newProvider: StorageProvider): void => undefined,
  _setDisabled: (_isDisabled: boolean): void => undefined,
}

export function useClientAsyncInit(
  _sdkKey: string,
  initialUser: StatsigUser,
): { client: StatsigClient; isLoading: boolean } {
  staticClient.updateUserSync(initialUser)
  return { client: staticClient, isLoading: false }
}

export function useStatsigClient(): {
  checkGate: StatsigClient['checkGate']
  client: StatsigClient
  getDynamicConfig: StatsigClient['getDynamicConfig']
  getExperiment: StatsigClient['getExperiment']
  getFeatureGate: StatsigClient['getFeatureGate']
  getLayer: StatsigClient['getLayer']
  logEvent: StatsigClient['logEvent']
} {
  const { client } = useContext(StatsigContext)
  return {
    client,
    checkGate: client.checkGate.bind(client),
    getFeatureGate: client.getFeatureGate.bind(client),
    getDynamicConfig: client.getDynamicConfig.bind(client),
    getExperiment: client.getExperiment.bind(client),
    getLayer: client.getLayer.bind(client),
    logEvent: client.logEvent.bind(client),
  }
}

export function useStatsigUser(): StatsigUser {
  return useContext(StatsigContext).client.getContext().user
}

export function useGateValue(name: string): boolean {
  return useContext(StatsigContext).client.checkGate(name)
}

export function useFeatureGate(name: string): FeatureGate {
  return useContext(StatsigContext).client.getFeatureGate(name)
}

export function useDynamicConfig(name: string): DynamicConfig {
  return useContext(StatsigContext).client.getDynamicConfig(name)
}

export function useExperiment(name: string): Experiment {
  return useContext(StatsigContext).client.getExperiment(name)
}

export function useLayer(name: string): Layer {
  return useContext(StatsigContext).client.getLayer(name)
}

export function getOverrideAdapter(): StaticOverrideAdapter {
  return overrideAdapter
}

export function getStatsigClient(): StatsigClient {
  return staticClient
}

export function bootstrapStatsigClient(user: StatsigUser, options: StatsigOptions): StatsigClient {
  staticClient.updateUserSync(user)
  return new StatsigClient(STATIC_SDK_KEY, user, options)
}
