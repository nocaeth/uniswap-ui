import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { lazy, ReactNode, Suspense, useMemo } from 'react'
import { matchPath, Navigate, useLocation } from 'react-router'
import i18n from 'uniswap/src/i18n'
import { getExploreDescription, getExploreTitle } from '~/pages/getExploreTitle'
import {
  getAddLiquidityPageTitle,
  getPositionPageDescription,
  getPositionPageTitle,
} from '~/pages/getPositionPageTitle'
// High-traffic page (/swap) should not be lazy-loaded.
import { SwapPage } from '~/pages/Swap'
import { isBrowserRouterEnabled } from '~/utils/env'

const AddLiquidity = lazy(() => import('~/pages/AddLiquidity/AddLiquidity'))
const CreatePosition = lazy(() => import('~/pages/CreatePosition/CreatePosition'))
const AddLiquidityV3WithTokenRedirects = lazy(() => import('~/pages/AddLiquidityV3/redirects'))
const RedirectExplore = lazy(() => import('~/pages/Explore/redirects'))
const NotFound = lazy(() => import('~/pages/NotFound'))
const Pool = lazy(() => import('~/pages/Positions'))
const LegacyPoolRedirects = lazy(() =>
  import('~/pages/LegacyPool/redirects').then((module) => ({ default: module.LegacyPoolRedirects })),
)
const LegacyPositionPageRedirects = lazy(() =>
  import('~/pages/LegacyPool/redirects').then((module) => ({ default: module.LegacyPositionPageRedirects })),
)
const PositionPage = lazy(() => import('~/pages/Positions/PositionPage'))
const PoolDetails = lazy(() => import('~/pages/PoolDetails'))
const TokenDetails = lazy(() => import('~/pages/TokenDetails/TokenDetailsPage'))

interface RouterConfig {
  browserRouterEnabled?: boolean
  hash?: string
  isAddLiquidityRevampEnabled?: boolean
  isEmbeddedWalletEnabled?: boolean
}

/**
 * Convenience hook which organizes the router configuration into a single object.
 */
export function useRouterConfig(): RouterConfig {
  const browserRouterEnabled = isBrowserRouterEnabled()
  const { hash } = useLocation()
  const isAddLiquidityRevampEnabled = useFeatureFlag(FeatureFlags.AddLiquidityRevamp)
  const isEmbeddedWalletEnabled = useFeatureFlag(FeatureFlags.EmbeddedWallet)

  return useMemo(
    () => ({
      browserRouterEnabled,
      hash,
      isAddLiquidityRevampEnabled,
      isEmbeddedWalletEnabled,
    }),
    [browserRouterEnabled, hash, isAddLiquidityRevampEnabled, isEmbeddedWalletEnabled],
  )
}

// SEO titles and descriptions sourced from https://docs.google.com/spreadsheets/d/1_6vSxGgmsx6QGEZ4mdHppv1VkuiJEro3Y_IopxUHGB4/edit#gid=0
// getTitle and getDescription are used as static metatags for SEO. Dynamic metatags should be set in the page component itself
const StaticTitlesAndDescriptions = {
  UniswapTitle: i18n.t('title.uniswapTradeCrypto'),
  SwapTitle: i18n.t('title.buySellTradeEthereum'),
  SwapDescription: i18n.t('title.swappingMadeSimple'),
  DetailsPageBaseTitle: i18n.t('common.buyAndSell'),
  TDPDescription: i18n.t('title.realTime'),
  PDPDescription: i18n.t('title.tradeTokens'),
  MigrateTitle: i18n.t('title.migratev2'),
  MigrateTitleV3: i18n.t('title.migratev3'),
  MigrateDescription: i18n.t('title.easilyRemove'),
  MigrateDescriptionV4: i18n.t('title.easilyRemoveV4'),
  AddLiquidityDescription: i18n.t('title.earnFees'),
}

export interface RouteDefinition {
  path: string
  nestedPaths: string[]
  getTitle: (path?: string) => string
  getDescription: (path?: string) => string
  enabled: (args: RouterConfig) => boolean
  getElement: (args: RouterConfig) => ReactNode
}

// Assigns the defaults to the route definition.
function createRouteDefinition(route: Partial<RouteDefinition>): RouteDefinition {
  return {
    getElement: () => null,
    getTitle: () => StaticTitlesAndDescriptions.UniswapTitle,
    getDescription: () => StaticTitlesAndDescriptions.SwapDescription,
    enabled: () => true,
    path: '/',
    nestedPaths: [],
    // overwrite the defaults
    ...route,
  }
}

export const routes: RouteDefinition[] = [
  createRouteDefinition({
    path: '/',
    getTitle: () => StaticTitlesAndDescriptions.SwapTitle,
    getDescription: () => StaticTitlesAndDescriptions.SwapDescription,
    // Gnosis-only build: no landing page. Go straight to swap (preserving any deep-link hash).
    getElement: (args) => {
      return args.browserRouterEnabled && args.hash ? (
        <Navigate to={args.hash.replace('#', '')} replace />
      ) : (
        <Navigate to="/swap" replace />
      )
    },
  }),
  createRouteDefinition({
    path: '/explore',
    getTitle: getExploreTitle,
    getDescription: getExploreDescription,
    nestedPaths: [':tab', ':chainName', ':tab/:chainName'],
    getElement: () => <RedirectExplore />,
  }),
  createRouteDefinition({
    path: '/explore/tokens/:chainName/:tokenAddress',
    getTitle: () => i18n.t('common.buyAndSell'),
    getDescription: () => StaticTitlesAndDescriptions.TDPDescription,
    getElement: () => (
      <Suspense fallback={null}>
        <TokenDetails />
      </Suspense>
    ),
  }),
  createRouteDefinition({
    path: '/tokens',
    getTitle: getExploreTitle,
    getDescription: getExploreDescription,
    getElement: () => <Navigate to="/explore/tokens" replace />,
  }),
  createRouteDefinition({
    path: '/tokens/:chainName',
    getTitle: getExploreTitle,
    getDescription: getExploreDescription,
    getElement: () => <RedirectExplore />,
  }),
  createRouteDefinition({
    path: '/tokens/:chainName/:tokenAddress',
    getTitle: () => StaticTitlesAndDescriptions.DetailsPageBaseTitle,
    getDescription: () => StaticTitlesAndDescriptions.TDPDescription,
    getElement: () => <RedirectExplore />,
  }),
  createRouteDefinition({
    path: '/explore/pools/:chainName/:poolAddress',
    getTitle: () => StaticTitlesAndDescriptions.DetailsPageBaseTitle,
    getDescription: () => StaticTitlesAndDescriptions.PDPDescription,
    getElement: () => (
      <Suspense fallback={null}>
        <PoolDetails />
      </Suspense>
    ),
  }),
  createRouteDefinition({
    path: '/swap',
    getElement: () => <SwapPage />,
    getTitle: () => StaticTitlesAndDescriptions.SwapTitle,
  }),
  // Refreshed pool routes
  createRouteDefinition({
    path: '/positions/add/new',
    getElement: () => <CreatePosition />,
    getTitle: getPositionPageTitle,
    getDescription: () => StaticTitlesAndDescriptions.AddLiquidityDescription,
    enabled: (args) => Boolean(args.isAddLiquidityRevampEnabled),
  }),
  createRouteDefinition({
    path: '/positions/add',
    // Nested path is optional: bare `/positions/add` browses pools; AddLiquidity reads the
    // optional `:chainName/:poolAddress` segments from `useParams`, so one definition covers both.
    nestedPaths: [':chainName/:poolAddress'],
    getElement: () => <AddLiquidity />,
    getTitle: getPositionPageTitle,
    getDescription: () => StaticTitlesAndDescriptions.AddLiquidityDescription,
    enabled: (args) => Boolean(args.isAddLiquidityRevampEnabled),
  }),
  createRouteDefinition({
    path: '/positions/create',
    getElement: () => <CreatePosition />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
    nestedPaths: [':protocolVersion'],
  }),
  createRouteDefinition({
    path: '/positions',
    getElement: () => <Pool />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
  }),
  createRouteDefinition({
    path: '/positions/v3/:chainName/:tokenId',
    getElement: () => <PositionPage />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
  }),
  // Legacy pool routes
  createRouteDefinition({
    path: '/pool',
    getElement: () => <LegacyPoolRedirects />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
  }),
  createRouteDefinition({
    path: '/pool/:tokenId',
    getElement: () => <LegacyPositionPageRedirects />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
  }),
  createRouteDefinition({
    path: '/pools',
    getElement: () => <LegacyPoolRedirects />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
  }),
  createRouteDefinition({
    path: '/pools/:tokenId',
    getElement: () => <LegacyPositionPageRedirects />,
    getTitle: getPositionPageTitle,
    getDescription: getPositionPageDescription,
  }),
  createRouteDefinition({
    path: '/add',
    nestedPaths: [
      ':currencyIdA',
      ':currencyIdA/:currencyIdB',
      ':currencyIdA/:currencyIdB/:feeAmount',
      ':currencyIdA/:currencyIdB/:feeAmount/:tokenId',
    ],
    getElement: () => <AddLiquidityV3WithTokenRedirects />,
    getTitle: getAddLiquidityPageTitle,
    getDescription: () => StaticTitlesAndDescriptions.AddLiquidityDescription,
  }),
  createRouteDefinition({
    path: '/remove/:tokenId',
    getElement: () => <LegacyPositionPageRedirects />,
    getTitle: () => i18n.t('title.removePoolLiquidity'),
    getDescription: () => i18n.t('title.removev3Liquidity'),
  }),
  createRouteDefinition({ path: '*', getElement: () => <Navigate to="/not-found" replace /> }),
  createRouteDefinition({ path: '/not-found', getElement: () => <NotFound /> }),
]

export const findRouteByPath = (pathname: string) => {
  for (const route of routes) {
    const match = matchPath(route.path, pathname)
    if (match) {
      return route
    }
    const subPaths = route.nestedPaths.map((nestedPath) => `${route.path}/${nestedPath}`)
    for (const subPath of subPaths) {
      // oxlint-disable-next-line no-shadow
      const match = matchPath(subPath, pathname)
      if (match) {
        return route
      }
    }
  }
  return undefined
}
