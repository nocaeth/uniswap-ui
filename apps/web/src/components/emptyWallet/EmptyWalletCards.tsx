import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Flex, useShadowPropsShort } from 'ui/src'
import { ArrowDownCircle } from 'ui/src/components/icons/ArrowDownCircle'
import { useDeviceDimensions } from 'ui/src/hooks/useDeviceDimensions'
import type { ActionCardItem } from 'uniswap/src/components/misc/ActionCard'
import { ActionCard } from 'uniswap/src/components/misc/ActionCard'
import { ElementName } from 'uniswap/src/features/telemetry/constants'
import { TestID } from 'uniswap/src/test/fixtures/testIDs'
import { useOpenReceiveCryptoModal } from '~/components/ReceiveCryptoModal/useOpenReceiveCryptoModal'
import { ReceiveModalState } from '~/types/receiveCryptoModal'

const EMPTY_WALLET_CARD_WIDTH = 464
const APP_PADDING = 16

export const EmptyWalletCards = (
  {
    horizontalLayout,
    growFullWidth,
    receiveElementName,
  }: {
    horizontalLayout?: boolean
    growFullWidth?: boolean
    receiveElementName: ElementName
  } = {
    horizontalLayout: false,
    growFullWidth: false,
    receiveElementName: ElementName.EmptyStateReceive,
  },
): JSX.Element => {
  const { t } = useTranslation()
  const { fullWidth } = useDeviceDimensions()
  const shadowProps = useShadowPropsShort()

  const handleReceiveCryptoClick = useOpenReceiveCryptoModal({
    modalState: ReceiveModalState.DEFAULT,
  })

  const options: ActionCardItem[] = useMemo(
    () => [
      {
        title: t('home.empty.transfer'),
        blurb: t('home.empty.transfer.description'),
        elementName: receiveElementName,
        icon: <ArrowDownCircle color="$accent1" size="$icon.28" />,
        onPress: handleReceiveCryptoClick,
        testId: TestID.WalletReceiveCrypto,
      },
    ],
    [handleReceiveCryptoClick, t, receiveElementName],
  )

  // Determine layout mode
  const isScrollableLayout = horizontalLayout && !growFullWidth
  const isFullWidthLayout = horizontalLayout && growFullWidth
  const needsLeftOffset = isScrollableLayout && fullWidth < EMPTY_WALLET_CARD_WIDTH - APP_PADDING

  // Calculate outer container width
  const outerContainerWidth = isFullWidthLayout ? '100%' : horizontalLayout ? fullWidth : '100%'

  // Calculate inner grid width
  const innerGridWidth = isFullWidthLayout ? '100%' : horizontalLayout ? EMPTY_WALLET_CARD_WIDTH : '100%'

  // Scroll styles for scrollable layout
  const scrollStyles = isScrollableLayout
    ? {
        overflowX: 'scroll' as const,
        scrollbarWidth: 'none' as const,
        paddingBottom: 6,
      }
    : undefined

  return (
    <Flex position="relative" width="100%" animation="fast" animateEnterExit="fadeInDownOutDown">
      <Flex
        row
        left={needsLeftOffset ? -APP_PADDING : undefined}
        width={outerContainerWidth}
        position={isScrollableLayout ? 'absolute' : undefined}
        style={scrollStyles}
      >
        <Flex
          $platform-web={
            horizontalLayout
              ? {
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                }
              : undefined
          }
          gap="$spacing12"
          width={innerGridWidth}
        >
          {options.map((option) => (
            <ActionCard
              key={option.title}
              {...option}
              leftAlign
              containerProps={horizontalLayout ? { gap: '$spacing8', px: '$spacing12' } : undefined}
              borderRadius={horizontalLayout ? '$rounded16' : undefined}
              shadowProps={shadowProps}
              hoverStyle={{
                backgroundColor: '$surface1Hovered',
                borderColor: '$surface3Hovered',
              }}
            />
          ))}
        </Flex>
        {isScrollableLayout && <Flex width={40} />}
      </Flex>
    </Flex>
  )
}
