export const SessionGateSource = {
  UnirpcViem: 'unirpc-viem',
  UnirpcEthers: 'unirpc-ethers',
  ConnectRpcEntryGateway: 'connect-rpc-entry-gateway',
  ConnectRpcEntryGatewayProd: 'connect-rpc-entry-gateway-prod',
  FetchUniswap: 'fetch-uniswap',
  FetchTrading: 'fetch-trading',
  FetchFor: 'fetch-for',
} as const

export const ChallengeType = {
  UNSPECIFIED: 0,
  TURNSTILE: 1,
  HASHCASH: 2,
  GITHUB: 3,
} as const

export const ChallengeFailureReason = {}
export const VerifyFailureReason = {}
export const SESSION_INIT_QUERY_KEY = ['session-init'] as const

export class SessionNotBootstrappedError extends Error {
  constructor() {
    super('Sessions are disabled in Gnosis lean builds.')
    this.name = 'SessionNotBootstrappedError'
  }
}

export class SessionReadyTimeoutError extends Error {}
export class SessionRecoveryFailedError extends Error {}
export class ChallengeRejectedError extends Error {}
export class SessionError extends Error {}
export class MaxChallengeRetriesError extends Error {}
export class NoSolverAvailableError extends Error {}
export class TurnstileScriptLoadError extends Error {}
export class TurnstileApiNotAvailableError extends Error {}
export class TurnstileTimeoutError extends Error {}
export class TurnstileError extends Error {}
export class TurnstileTokenExpiredError extends Error {}
export class HashcashWorkerBootError extends Error {}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type Interceptor = (next: (request: unknown) => Promise<unknown>) => (request: unknown) => Promise<unknown>

function createNoopSession() {
  return {
    ready: async (): Promise<void> => undefined,
    recover: async (): Promise<void> => undefined,
    getState: (): 'ready' => 'ready',
    subscribe: (): (() => void) => () => undefined,
  }
}

export function createDeviceIdService(
  ctx: {
    getDeviceId?: () => Promise<string>
    setDeviceId?: (deviceId: string) => Promise<void>
    removeDeviceId?: () => Promise<void>
  } = {},
) {
  return {
    getDeviceId: ctx.getDeviceId ?? (async (): Promise<string> => ''),
    setDeviceId: ctx.setDeviceId ?? (async (): Promise<void> => undefined),
    removeDeviceId: ctx.removeDeviceId ?? (async (): Promise<void> => undefined),
  }
}

export function createUniswapIdentifierService(
  ctx: {
    get?: () => Promise<string | null>
    set?: (identifier: string) => Promise<void>
    remove?: () => Promise<void>
  } = {},
) {
  return {
    get: ctx.get ?? (async (): Promise<null> => null),
    set: ctx.set ?? (async (): Promise<void> => undefined),
    remove: ctx.remove ?? (async (): Promise<void> => undefined),
  }
}

export function uniswapIdentifierQuery() {
  return {
    queryKey: ['uniswap-identifier'],
    queryFn: async (): Promise<null> => null,
  }
}

export function createSessionStorage() {
  return {
    get: async (): Promise<null> => null,
    set: async (): Promise<void> => undefined,
    remove: async (): Promise<void> => undefined,
  }
}

export function createNoopSessionService() {
  return {
    initSession: async () => ({ needChallenge: false, extra: {} }),
    requestChallenge: async () => ({
      challengeId: 'noop',
      challengeType: ChallengeType.UNSPECIFIED,
      extra: {},
    }),
    verifySession: async () => ({ retry: false }),
    removeSession: async (): Promise<void> => undefined,
    getSessionState: async (): Promise<null> => null,
  }
}

export function createSessionService() {
  return createNoopSessionService()
}

export function createSessionClient() {
  return {}
}

export function createSessionRepository() {
  return {}
}

export function createSessionInitializationService() {
  return {
    initSession: async () => ({ needChallenge: false, extra: {} }),
  }
}

export function sessionInitQuery() {
  return {
    queryKey: SESSION_INIT_QUERY_KEY,
    queryFn: async () => ({ needChallenge: false, extra: {} }),
  }
}

export function createSession() {
  return createNoopSession()
}

export function singleflight<T extends (...args: never[]) => Promise<unknown>>(fn: T): T {
  return fn
}

export async function gated<T>({ call }: { call: () => Promise<T> }): Promise<T> {
  return call()
}

export function isConnectUnauthorized(): boolean {
  return false
}

export function isFetchUnauthorized(): boolean {
  return false
}

export function isSessionAuthFailureStatus(status?: number | null): boolean {
  return status === 401 || status === 403
}

export function requireSessionInterceptor(): Interceptor {
  return (next) => (request) => next(request)
}

export function requireSessionFetch(): (inner: FetchLike) => FetchLike {
  return (inner) => inner
}

export function withSession<T extends (...args: never[]) => Promise<unknown>>(fn: T): T {
  return fn
}

export function createChallengeSolverService() {
  return {
    solve: async () => null,
  }
}

export function createTurnstileMockSolver() {
  return { solve: async () => null }
}

export function createHashcashMockSolver() {
  return { solve: async () => null }
}

export function createNoneMockSolver() {
  return { solve: async () => null }
}

export function createTurnstileSolver() {
  return createTurnstileMockSolver()
}

export function createHashcashSolver() {
  return createHashcashMockSolver()
}

export function createWorkerHashcashSolver() {
  return createHashcashMockSolver()
}

export function createHashcashWorkerChannel() {
  return {}
}

export function createHashcashMultiWorkerChannel() {
  return {}
}

export function createOAuthService() {
  return {}
}
