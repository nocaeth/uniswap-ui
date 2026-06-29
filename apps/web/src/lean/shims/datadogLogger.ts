import type { Action, AnyAction, PreloadedState, Reducer, StoreEnhancerStoreCreator } from 'redux'
import type { ReduxEnhancerConfig } from 'utilities/src/logger/datadog/Datadog'
import type { LoggerErrorContext, LogLevel } from 'utilities/src/logger/types'

export function createDatadogReduxEnhancer(
  _config: ReduxEnhancerConfig,
): (next: StoreEnhancerStoreCreator) => StoreEnhancerStoreCreator {
  return (next: StoreEnhancerStoreCreator): StoreEnhancerStoreCreator =>
    <S = unknown, A extends Action = AnyAction>(reducer: Reducer<S, A>, initialState?: PreloadedState<S>) =>
      next(reducer, initialState)
}

export function logToDatadog(
  _message: string,
  _options: {
    level: LogLevel
    args: unknown[]
    fileName: string
    functionName: string
  },
): void {}

export function logWarningToDatadog(
  _message: string,
  _options: {
    level: LogLevel
    args: unknown[]
    fileName: string
    functionName: string
  },
): void {}

export function logErrorToDatadog(_error: Error, _context?: LoggerErrorContext): void {}

export function attachUnhandledRejectionHandler(): void {}

export async function setAttributesToDatadog(_attributes: { [key: string]: unknown }): Promise<void> {}
