import { ApiInit, getEntryGatewayUrl, provideSessionService } from '@universe/api'
import {
  getIsHashcashSolverEnabled,
  getIsSessionServiceEnabled,
  getIsSessionsPerformanceTrackingEnabled,
  getIsSessionUpgradeAutoEnabled,
  getIsTurnstileSolverEnabled,
  useIsSessionServiceEnabled,
} from '@universe/gating'
import {
  type ChallengeSolver,
  ChallengeType,
  createChallengeSolverService,
  createHashcashMockSolver,
  createHashcashSolver,
  createHashcashWorkerChannel,
  createPerformanceTracker,
  createSessionInitializationService,
  createTurnstileMockSolver,
  createTurnstileSolver,
} from '@universe/sessions'
import { getLogger } from 'utilities/src/logger/logger'
import { onHashcashSolveCompleted, onTurnstileSolveCompleted, sessionInitAnalytics } from '~/sessions/analytics'

const provideSessionInitService = () => {
  const performanceTracker = createPerformanceTracker({
    getIsPerformanceTrackingEnabled: getIsSessionsPerformanceTrackingEnabled,
    getNow: () => performance.now(),
  })

  const solvers = new Map<ChallengeType, ChallengeSolver>()

  if (getIsTurnstileSolverEnabled()) {
    solvers.set(
      ChallengeType.TURNSTILE,
      createTurnstileSolver({
        performanceTracker,
        getLogger,
        onSolveCompleted: onTurnstileSolveCompleted,
      }),
    )
  } else {
    solvers.set(ChallengeType.TURNSTILE, createTurnstileMockSolver())
  }
  if (getIsHashcashSolverEnabled()) {
    solvers.set(
      ChallengeType.HASHCASH,
      createHashcashSolver({
        performanceTracker,
        getWorkerChannel: () =>
          createHashcashWorkerChannel({
            getWorker: () => {
              return new Worker(
                new URL('@universe/sessions/src/challenge-solvers/hashcash/worker/hashcash.worker.ts', import.meta.url),
                { type: 'module' },
              )
            },
          }),
        onSolveCompleted: onHashcashSolveCompleted,
        getLogger,
      }),
    )
  } else {
    solvers.set(ChallengeType.HASHCASH, createHashcashMockSolver())
  }

  return createSessionInitializationService({
    performanceTracker,
    getSessionService: () =>
      provideSessionService({
        getBaseUrl: getEntryGatewayUrl,
        getIsSessionServiceEnabled,
        getLogger,
      }),
    challengeSolverService: createChallengeSolverService({
      solvers,
      getLogger,
    }),
    getIsSessionUpgradeAutoEnabled,
    getLogger,
    analytics: sessionInitAnalytics,
  })
}

export default function ApiSessionInitializer(): JSX.Element {
  const isSessionServiceEnabled = useIsSessionServiceEnabled()
  return <ApiInit getSessionInitService={provideSessionInitService} isSessionServiceEnabled={isSessionServiceEnabled} />
}
