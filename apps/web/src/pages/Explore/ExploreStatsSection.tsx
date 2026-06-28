import { Fragment, memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, Flex, Text, useMedia } from 'ui/src'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { NumberType } from 'utilities/src/format/types'
import { DeltaArrow } from '~/components/DeltaArrow/DeltaArrow'
import { LoadingBubble } from '~/components/Tokens/loading'
import { use24hProtocolVolume, useDailyTVLWithChange } from '~/features/Explore/state/protocolStats'

interface ExploreStatSectionData {
  label: string
  value: string
  change: number
}

export const ExploreStatsSection = ({ shouldHideStats = false }: { shouldHideStats?: boolean }) => {
  const media = useMedia()
  const { t } = useTranslation()
  const { convertFiatAmountFormatted } = useLocalizationContext()

  const {
    totalVolume,
    totalVolume7d,
    totalVolume30d,
    totalChangePercent: volume24hChangePercent,
    totalVolume7dChangePercent,
    totalVolume30dChangePercent,
    isLoading: isVolumeLoading,
  } = use24hProtocolVolume()
  const { protocolTVL, protocolChangePercent, isLoading: isTVLLoading } = useDailyTVLWithChange()

  const isStatDataLoading = isVolumeLoading || isTVLLoading

  const exploreStatsSectionData = useMemo(() => {
    const formatPrice = (price: number) => convertFiatAmountFormatted(price, NumberType.FiatTokenPrice)

    const stats = [
      {
        label: t('stats.volume.1d.long'),
        value: formatPrice(totalVolume),
        change: volume24hChangePercent,
      },
      {
        label: t('stats.volume.7d.long'),
        value: formatPrice(totalVolume7d),
        change: totalVolume7dChangePercent,
      },
      {
        label: t('stats.volume.30d.long'),
        value: formatPrice(totalVolume30d),
        change: totalVolume30dChangePercent,
      },
      { label: t('explore.v3TVL'), value: formatPrice(protocolTVL.v3), change: protocolChangePercent.v3 },
    ]

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    return stats.filter((state): state is Exclude<typeof state, null> => state !== null)
  }, [
    t,
    convertFiatAmountFormatted,
    totalVolume,
    volume24hChangePercent,
    totalVolume7d,
    totalVolume30d,
    totalVolume7dChangePercent,
    totalVolume30dChangePercent,
    protocolTVL.v3,
    protocolChangePercent.v3,
  ])

  const visibleStats = media.md ? exploreStatsSectionData.slice(0, 2) : exploreStatsSectionData

  return (
    <AnimatePresence>
      {!shouldHideStats && (
        <Flex
          row
          width="100%"
          key="explore-stats"
          animation="300ms"
          enterStyle={{ opacity: 0, y: -10 }}
          exitStyle={{ opacity: 0, y: -10 }}
          transition="opacity 0.3s ease, transform 0.3s ease"
        >
          {visibleStats.map((data, index) => (
            <Flex
              key={data.label}
              borderLeftWidth={index === 0 ? 0 : '$spacing1'}
              borderColor="$surface3"
              pl={index === 0 ? 0 : '$spacing24'}
              flex={1}
              cursor="default"
              transition="opacity 0.3s ease, transform 0.3s ease"
            >
              <StatDisplay data={data} isLoading={isStatDataLoading} />
            </Flex>
          ))}
        </Flex>
      )}
    </AnimatePresence>
  )
}

interface StatDisplayProps {
  data: ExploreStatSectionData
  isLoading?: boolean
  isHoverable?: boolean
}

const StatDisplay = memo(({ data, isLoading, isHoverable }: StatDisplayProps) => {
  const { formatPercent } = useLocalizationContext()
  const { t } = useTranslation()
  const hasChange = Number.isFinite(data.change)

  return (
    <Flex transition="all 0.1s ease-in-out" group gap="$spacing4" minHeight="$spacing60">
      <Text variant="body4" color="$neutral2" $group-hover={{ color: isHoverable ? '$neutral2Hovered' : '$neutral2' }}>
        {data.label}
      </Text>
      {isLoading ? (
        <LoadingBubble height="24px" width="80px" />
      ) : (
        <Text variant="subheading1" color="$neutral1">
          {data.value}
        </Text>
      )}
      <Flex row alignItems="center" gap="$spacing2" style={{ fontSize: 12 }} minHeight="$spacing16">
        {isLoading ? (
          <LoadingBubble height="12px" width="60px" />
        ) : (
          <Fragment>
            {hasChange && (
              <DeltaArrow delta={data.change} formattedDelta={formatPercent(Math.abs(data.change))} size={12} />
            )}
            <Text variant="body4" color="$neutral1">
              {hasChange ? `${formatPercent(Math.abs(data.change))} ${t('common.today').toLocaleLowerCase()}` : '-'}
            </Text>
          </Fragment>
        )}
      </Flex>
    </Flex>
  )
})

StatDisplay.displayName = 'StatDisplay'
