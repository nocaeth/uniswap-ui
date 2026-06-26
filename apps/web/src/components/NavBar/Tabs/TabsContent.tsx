import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { CoinConvert } from 'ui/src/components/icons/CoinConvert'
import { Compass } from 'ui/src/components/icons/Compass'
import { Pools } from 'ui/src/components/icons/Pools'
import { SwapDotted } from 'ui/src/components/icons/SwapDotted'
import { ElementName } from 'uniswap/src/features/telemetry/constants'
import { MenuItem } from '~/components/NavBar/CompanyMenu/Content'

export type TabsSection = {
  title: string
  href: string
  isActive?: boolean
  items?: TabsItem[]
  closeMenu?: () => void
  icon?: JSX.Element
  elementName: ElementName
}

export type TabsItem = MenuItem & {
  icon?: JSX.Element
}

export const useTabsContent = (): TabsSection[] => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const isAddLiquidityRevamp = useFeatureFlag(FeatureFlags.AddLiquidityRevamp)

  return [
    {
      title: t('common.trade'),
      href: '/swap',
      isActive: pathname.startsWith('/swap'),
      icon: <CoinConvert color="$accent1" size="$icon.20" />,
      elementName: ElementName.NavbarTradeTab,
      items: [
        {
          label: t('common.swap'),
          icon: <SwapDotted size="$icon.24" color="$neutral2" />,
          href: '/swap',
          internal: true,
          elementName: ElementName.NavbarTradeDropdownSwap,
        },
      ],
    },
    {
      title: t('common.explore'),
      href: '/explore',
      isActive: pathname.startsWith('/explore'),
      icon: <Compass color="$accent1" size="$icon.20" />,
      elementName: ElementName.NavbarExploreTab,
      items: [
        {
          label: t('common.tokens'),
          href: '/explore/tokens',
          internal: true,
          elementName: ElementName.NavbarExploreDropdownTokens,
        },
        {
          label: t('common.pools'),
          href: '/explore/pools',
          internal: true,
          elementName: ElementName.NavbarExploreDropdownPools,
        },
        {
          label: t('common.transactions'),
          href: '/explore/transactions',
          internal: true,
          elementName: ElementName.NavbarExploreDropdownTransactions,
        },
      ],
    },
    {
      title: t('common.pool'),
      href: '/positions',
      isActive: pathname.startsWith('/positions') || pathname.startsWith('/liquidity'),
      icon: <Pools color="$accent1" size="$icon.20" />,
      elementName: ElementName.NavbarPoolTab,
      items: [
        {
          label: t('nav.tabs.viewPositions'),
          href: '/positions',
          internal: true,
          elementName: ElementName.NavbarPoolDropdownViewPositions,
        },
        {
          label: t('nav.tabs.createPosition'),
          href: isAddLiquidityRevamp ? '/positions/add' : '/positions/create',
          internal: true,
          elementName: ElementName.NavbarPoolDropdownCreatePosition,
        },
      ],
    },
  ]
}
