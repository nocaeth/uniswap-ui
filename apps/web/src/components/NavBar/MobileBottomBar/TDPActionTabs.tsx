import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button, Flex, useMedia } from 'ui/src'
import { ArrowDownCircle } from 'ui/src/components/icons/ArrowDownCircle'
import { ArrowUpCircle } from 'ui/src/components/icons/ArrowUpCircle'
import { toGraphQLEntityChain } from 'uniswap/src/features/chains/utils'
import { isEVMChain } from 'uniswap/src/features/platforms/utils/chains'
import { NATIVE_CHAIN_ID } from '~/constants/tokens'
import { useActiveAccount } from '~/features/accounts/store/hooks'
import { useSelectChain } from '~/hooks/useSelectChain'
import { useTDPStore } from '~/pages/TokenDetails/context/useTDPStore'
import { getChainUrlParam } from '~/utils/params/chainParams'

const TDP_ACTION_TABS_MAX_WIDTH = 780

type TabItem = {
  label: string
  href: string
  icon: JSX.Element
}

export function TDPActionTabs() {
  const { t } = useTranslation()
  const { currencyChainId, address, tokenColor, multiChainMap } = useTDPStore((s) => ({
    currencyChainId: s.currencyChainId,
    address: s.address,
    tokenColor: s.tokenColor,
    multiChainMap: s.multiChainMap,
  }))
  const selectChain = useSelectChain()
  const navigate = useNavigate()

  const currentConnectedChainId = useActiveAccount(currencyChainId)?.chainId

  const pageChainKey = toGraphQLEntityChain(currencyChainId)
  const hasBalance = Boolean(multiChainMap[pageChainKey]?.balance)

  const chainUrlParam = getChainUrlParam(currencyChainId)
  const addressUrlParam = address === NATIVE_CHAIN_ID ? 'ETH' : address
  const media = useMedia()
  const showIcons = !media.xs

  const toActionLink = useCallback(
    async (href: string) => {
      if (currentConnectedChainId && currentConnectedChainId !== currencyChainId && isEVMChain(currencyChainId)) {
        await selectChain(currencyChainId)
      }
      navigate(href)
    },
    [currentConnectedChainId, currencyChainId, selectChain, navigate],
  )

  const tabs: TabItem[] = useMemo(
    () => [
      {
        label: t('common.buy.label'),
        href: `/swap/?chain=${chainUrlParam}&outputCurrency=${addressUrlParam}`,
        icon: <ArrowDownCircle />,
      },
      ...(hasBalance
        ? [
            {
              label: t('common.sell.label'),
              href: `/swap?chain=${chainUrlParam}&inputCurrency=${addressUrlParam}`,
              icon: <ArrowUpCircle />,
            },
          ]
        : []),
    ],
    [t, chainUrlParam, addressUrlParam, hasBalance],
  )
  return (
    <Flex row justifyContent="center" gap="$spacing8" width="100%" mx="auto" maxWidth={TDP_ACTION_TABS_MAX_WIDTH}>
      {tabs.map((tab) => (
        <Button
          key={tab.label}
          onPress={() => toActionLink(tab.href)}
          backgroundColor={tokenColor}
          size="medium"
          icon={showIcons ? tab.icon : undefined}
        >
          {tab.label}
        </Button>
      ))}
    </Flex>
  )
}
