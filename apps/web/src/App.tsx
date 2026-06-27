import { useEffect } from 'react'
import { Helmet } from 'react-helmet-async/lib/index'
import { Navigate, useLocation } from 'react-router'
import { useSporeColors } from 'ui/src'
import { initializeScrollWatcher } from 'uniswap/src/components/modals/ScrollLock'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { ResetPageScrollEffect } from '~/app/bootstrap/ResetPageScroll'
import { ResetPortfolioChainOnEntryEffect } from '~/app/bootstrap/ResetPortfolioChainOnEntry'
import { UserPropertyUpdater } from '~/app/bootstrap/UserPropertyUpdater'
import { AppLayout } from '~/app/layout/Layout'
import { ErrorBoundary } from '~/components/ErrorBoundary'
import { useFeatureFlagUrlOverrides } from '~/featureFlags/useFeatureFlagUrlOverrides'
import { useDynamicMetatags } from '~/pages/metatags'
import { findRouteByPath } from '~/pages/RouteDefinitions'
import { isPathBlocked } from '~/utils/blockedPaths'
import { getCurrentPageFromLocation } from '~/utils/urlRoutes'

export function App() {
  const colors = useSporeColors()

  const location = useLocation()
  const { pathname } = location
  const currentPage = getCurrentPageFromLocation(pathname)

  useFeatureFlagUrlOverrides()

  useEffect(() => {
    initializeScrollWatcher()
  }, [])

  const metaTags = useDynamicMetatags()
  const staticTitle = findRouteByPath(pathname)?.getTitle(pathname) ?? 'NOCA'
  const staticDescription = findRouteByPath(pathname)?.getDescription(pathname)

  const shouldBlockPath = isPathBlocked(pathname)
  if (shouldBlockPath && pathname !== '/swap') {
    return <Navigate to="/swap" replace />
  }

  return (
    <ErrorBoundary>
      <Trace page={currentPage}>
        {/*
          This is where *static* page titles are injected into the <head> tag. If you
          want to set a page title based on data that's dynamic or not available on first render,
          you can set it later in the page component itself, since react-helmet-async prefers the most recently rendered title.
        */}
        <Helmet>
          <title>{staticTitle}</title>
          {staticDescription && <meta name="description" content={staticDescription} />}
          {staticDescription && <meta property="og:description" content={staticDescription} />}
          {metaTags.map((tag, index) => (
            <meta key={index} {...tag} />
          ))}
          <style>{`
            html {
              ::-webkit-scrollbar-thumb {
                background-color: ${colors.surface3.val};
              }
              scrollbar-color: ${colors.surface3.val} ${colors.surface1.val};
            }
          `}</style>
        </Helmet>
        <UserPropertyUpdater />
        <ResetPageScrollEffect />
        <ResetPortfolioChainOnEntryEffect />
        <AppLayout />
      </Trace>
    </ErrorBoundary>
  )
}
