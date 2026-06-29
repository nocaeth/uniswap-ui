// Ordering is intentional and must be preserved: sideEffects followed by functionality.
import '~/sideEffects'
import { ApolloProvider } from '@apollo/client'
import { ComplianceClientProvider } from '@universe/compliance'
import { isDevEnv, isTestEnv } from '@universe/environment'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7'
import { lazy, StrictMode, Suspense, type PropsWithChildren, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Helmet, HelmetProvider } from 'react-helmet-async/lib/index'
import { I18nextProvider } from 'react-i18next'
import { configureReanimatedLogger } from 'react-native-reanimated'
import { Provider } from 'react-redux'
import { BrowserRouter, HashRouter, useLocation } from 'react-router'
import { PortalProvider } from 'ui/src'
import { ReactRouterUrlProvider } from 'uniswap/src/contexts/UrlContext'
import { initializePortfolioQueryOverrides } from 'uniswap/src/data/rest/portfolioBalanceOverrides'
import { LocalizationContextProvider } from 'uniswap/src/features/language/LocalizationContext'
import i18n from 'uniswap/src/i18n'
import { App } from '~/App'
import { WebUniswapProvider } from '~/app/WebUniswapContext'
import { apolloClient } from '~/appGraphql/data/apollo/client'
import { TransactionWatcherProvider } from '~/appGraphql/data/apollo/TransactionWatcherProvider'
import { QueryClientPersistProvider } from '~/components/PersistQueryClient'
import { createWeb3Provider, WalletCapabilitiesEffects } from '~/components/Web3Provider/createWeb3Provider'
import { wagmiConfig } from '~/connection/wagmiConfig'
import { AccountsStoreDevTool } from '~/features/accounts/store/devtools'
import { WebAccountsStoreProvider } from '~/features/accounts/store/provider'
import { ConnectWalletMutationProvider } from '~/features/wallet/connection/hooks/useConnectWalletMutation'
import { ExternalWalletProvider } from '~/features/wallet/providers/ExternalWalletProvider'
import { useDeferredComponent } from '~/hooks/useDeferredComponent'
import { LanguageProvider } from '~/i18n/LanguageProvider'
import { BlockNumberProvider } from '~/lib/hooks/useBlockNumber'
import store from '~/state'
import { LivePricesProvider } from '~/state/livePrices/LivePricesProvider'
import { ThemedGlobalStyle, ThemeProvider } from '~/theme'
import { TamaguiProvider } from '~/theme/tamaguiProvider'
import { isBrowserRouterEnabled } from '~/utils/env'
import { unregister as unregisterServiceWorker } from '~/utils/serviceWorker'
import { getCanonicalUrl } from '~/utils/urlRoutes'

if (window.ethereum) {
  window.ethereum.autoRefreshOnNetworkChange = false
}

if (__DEV__ && !isTestEnv()) {
  configureReanimatedLogger({
    strict: false,
  })
}

initializePortfolioQueryOverrides({ store })

const loadApplicationUpdater = () => import('~/state/application/updater')
const loadActivityStateUpdater = () => import('~/state/activity/updater')
const loadWebAccountsStoreUpdater = () => import('~/features/accounts/store/updater')

function NullUpdater(): null {
  return null
}

const loadNullUpdater = async () => ({ default: NullUpdater })

const loadLeanListsUpdater = __GNOSIS_LEAN_BUILD__ ? loadNullUpdater : () => import('~/state/lists/updater')
const loadLeanLogsUpdater = __GNOSIS_LEAN_BUILD__ ? loadNullUpdater : () => import('~/state/logs/updater')
const loadLeanFiatOnRampTransactionsUpdater = __GNOSIS_LEAN_BUILD__
  ? loadNullUpdater
  : () => import('~/state/fiatOnRampTransactions/updater')

const ApiSessionInitializerLazy = __GNOSIS_LEAN_BUILD__
  ? null
  : lazy(() => import('~/app/bootstrap/ApiSessionInitializer'))

function Updaters() {
  const location = useLocation()

  const ListsUpdater = useDeferredComponent(loadLeanListsUpdater)
  const ApplicationUpdater = useDeferredComponent(loadApplicationUpdater)
  const ActivityStateUpdater = useDeferredComponent(loadActivityStateUpdater)
  const LogsUpdater = useDeferredComponent(loadLeanLogsUpdater)
  const FiatOnRampTransactionsUpdater = useDeferredComponent(loadLeanFiatOnRampTransactionsUpdater)
  const WebAccountsStoreUpdater = useDeferredComponent(loadWebAccountsStoreUpdater)

  return (
    <>
      <Helmet>
        <link rel="canonical" href={getCanonicalUrl(location.pathname, location.search)} />
      </Helmet>
      {ListsUpdater && <ListsUpdater />}
      {ApplicationUpdater && <ApplicationUpdater />}
      {ActivityStateUpdater && <ActivityStateUpdater />}
      {LogsUpdater && <LogsUpdater />}
      {FiatOnRampTransactionsUpdater && <FiatOnRampTransactionsUpdater />}
      {WebAccountsStoreUpdater && <WebAccountsStoreUpdater />}
      <AccountsStoreDevTool />
      {ApiSessionInitializerLazy && (
        <Suspense fallback={null}>
          <ApiSessionInitializerLazy />
        </Suspense>
      )}
    </>
  )
}

// Production Web3Provider – always reconnects on mount and runs capability effects.
const Web3Provider = createWeb3Provider({ wagmiConfig })

function GraphqlProviders({ children }: { children: ReactNode }) {
  return <ApolloProvider client={apolloClient}>{children}</ApolloProvider>
}

const LiveStatsigProviderLazy = __GNOSIS_LEAN_BUILD__
  ? null
  : lazy(() => import('~/app/bootstrap/LiveStatsigProvider').then((m) => ({ default: m.LiveStatsigProvider })))

function AppStatsigProvider({ children }: PropsWithChildren): JSX.Element {
  if (!LiveStatsigProviderLazy) {
    return <>{children}</>
  }

  return (
    <Suspense fallback={null}>
      <LiveStatsigProviderLazy>{children}</LiveStatsigProviderLazy>
    </Suspense>
  )
}

const WebNotificationServiceManagerLazy = __GNOSIS_LEAN_BUILD__
  ? null
  : lazy(() =>
      import('~/notification-service/WebNotificationService').then((m) => ({
        default: m.WebNotificationServiceManager,
      })),
    )

// Gated by `__DEV__` (Vite build-time constant) so Rollup DCE's the `import('agentation')`
// call in production builds and no chunk is emitted.
const AgentationLazy = __DEV__ ? lazy(() => import('agentation').then((m) => ({ default: m.Agentation }))) : null

const container = document.getElementById('root') as HTMLElement

const Router = isBrowserRouterEnabled() ? BrowserRouter : HashRouter

const RootApp = (): JSX.Element => {
  return (
    <StrictMode>
      <HelmetProvider>
        <ReactRouterUrlProvider>
          <Provider store={store}>
            <QueryClientPersistProvider>
              <ComplianceClientProvider>
                <NuqsAdapter>
                  <Router>
                    <I18nextProvider i18n={i18n}>
                      <LanguageProvider>
                        <Web3Provider>
                          <AppStatsigProvider>
                            <WalletCapabilitiesEffects />
                            <ExternalWalletProvider>
                              <ConnectWalletMutationProvider>
                                <WebAccountsStoreProvider>
                                  <WebUniswapProvider>
                                    <GraphqlProviders>
                                      <TransactionWatcherProvider>
                                        <LivePricesProvider>
                                          <LocalizationContextProvider>
                                            <BlockNumberProvider>
                                              <Updaters />
                                              <ThemeProvider>
                                                <TamaguiProvider>
                                                  <PortalProvider>
                                                    {WebNotificationServiceManagerLazy && (
                                                      <Suspense fallback={null}>
                                                        <WebNotificationServiceManagerLazy />
                                                      </Suspense>
                                                    )}
                                                    <ThemedGlobalStyle />
                                                    <App />
                                                    {AgentationLazy && isDevEnv() && (
                                                      <Suspense fallback={null}>
                                                        <AgentationLazy />
                                                      </Suspense>
                                                    )}
                                                  </PortalProvider>
                                                </TamaguiProvider>
                                              </ThemeProvider>
                                            </BlockNumberProvider>
                                          </LocalizationContextProvider>
                                        </LivePricesProvider>
                                      </TransactionWatcherProvider>
                                    </GraphqlProviders>
                                  </WebUniswapProvider>
                                </WebAccountsStoreProvider>
                              </ConnectWalletMutationProvider>
                            </ExternalWalletProvider>
                          </AppStatsigProvider>
                        </Web3Provider>
                      </LanguageProvider>
                    </I18nextProvider>
                  </Router>
                </NuqsAdapter>
              </ComplianceClientProvider>
            </QueryClientPersistProvider>
          </Provider>
        </ReactRouterUrlProvider>
      </HelmetProvider>
    </StrictMode>
  )
}

createRoot(container).render(<RootApp />)

// We once had a ServiceWorker, and users who have not visited since then may still have it registered.
// This ensures it is truly gone.
unregisterServiceWorker()
