import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flex, Image, SpinningLoader, Text, useSporeColors } from 'ui/src'
import { BINANCE_WALLET_ICON } from 'ui/src/assets'
import { Chevron } from 'ui/src/components/icons/Chevron'
import { WalletFilled } from 'ui/src/components/icons/WalletFilled'
import { UseSporeColorsReturn } from 'ui/src/hooks/useSporeColors'
import { iconSizes } from 'ui/src/theme'
import { CONNECTION_PROVIDER_IDS } from 'uniswap/src/constants/web3'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { ElementName, InterfaceEventName } from 'uniswap/src/features/telemetry/constants'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { useEvent } from 'utilities/src/react/hooks'
import { MenuStateVariant, useSetMenu } from '~/components/AccountDrawer/menuState'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { DetectedBadge } from '~/components/WalletModal/shared'
import { WalletBrandedIcon } from '~/components/WalletModal/WalletBrandedIcon'
import { useRecentConnectorId } from '~/connection/constants'
import { useIsInjectedWallet } from '~/features/accounts/store/hooks'
import { ExternalWallet } from '~/features/accounts/store/types'
import { useConnectWallet } from '~/features/wallet/connection/hooks/useConnectWallet'
import { isIFramed } from '~/utils/isIFramed'

function RecentBadge() {
  const { t } = useTranslation()

  return (
    <Text variant="body4" color="$accent1">
      {t('common.recent')}
    </Text>
  )
}

function BinanceWalletIcon({ iconSize }: { iconSize: number }) {
  return <Image height={iconSize} source={BINANCE_WALLET_ICON} width={iconSize} borderRadius="$rounded8" />
}

function OtherWalletsIcon() {
  return (
    <Flex p="$spacing6" backgroundColor="$accent2" borderRadius="$rounded8">
      <WalletFilled size={20} color="$accent1" />
    </Flex>
  )
}

function WalletFallbackIcon({ iconSize }: { iconSize: number }) {
  return (
    <Flex
      width={iconSize}
      height={iconSize}
      alignItems="center"
      justifyContent="center"
      backgroundColor="$surface3"
      borderRadius="$rounded8"
    >
      <WalletFilled size={20} color="$neutral2" />
    </Flex>
  )
}

function WalletImageIcon({
  icon,
  name,
  iconSize,
  borderColor,
}: {
  icon: string
  name: string
  iconSize: number
  borderColor: string
}) {
  const [hasError, setHasError] = useState(false)

  if (hasError) {
    return <WalletFallbackIcon iconSize={iconSize} />
  }

  return (
    <img
      src={icon}
      alt={name}
      style={{
        width: iconSize,
        height: iconSize,
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
      }}
      onError={() => setHasError(true)}
    />
  )
}

/** Returns the correct icon for custom wallet connectors. */
function getIcon({ wallet, themeColors }: { wallet: ExternalWallet; themeColors: UseSporeColorsReturn }) {
  const iconSize = iconSizes.icon40

  if (wallet.id === CONNECTION_PROVIDER_IDS.UNISWAP_WALLET_CONNECT_CONNECTOR_ID) {
    return <WalletBrandedIcon size={iconSize} />
  } else if (wallet.id === CONNECTION_PROVIDER_IDS.UNISWAP_EXTENSION_RDNS) {
    return <WalletBrandedIcon size={iconSize} withChromeBadge />
  } else if (wallet.id === CONNECTION_PROVIDER_IDS.BINANCE_WALLET_CONNECTOR_ID) {
    return <BinanceWalletIcon iconSize={iconSize} />
  } else if (!wallet.icon) {
    return <WalletFallbackIcon iconSize={iconSize} />
  } else {
    // TODO(WEB-7217): RN Web Image is not properly displaying base64 encoded images (Phantom logo) */
    return (
      <WalletImageIcon
        icon={wallet.icon}
        name={wallet.name}
        iconSize={iconSize}
        borderColor={themeColors.surface3.val}
      />
    )
  }
}

function getConnectorText({ wallet }: { wallet: ExternalWallet }) {
  return wallet.name
}

function RightSideDetail({
  isPendingConnection,
  isRecent,
  detected,
}: {
  isPendingConnection: boolean
  isRecent: boolean
  detected?: boolean
}) {
  if (isPendingConnection) {
    return <SpinningLoader size={16} color="$accent1" unstyled />
  } else if (isRecent) {
    return <RecentBadge />
  } else if (detected) {
    return <DetectedBadge />
  }
  return null
}

export function WalletConnectorOption({
  wallet,
  connectOnPlatform = 'any',
  rightSideDetail,
}: {
  wallet: ExternalWallet
  connectOnPlatform?: Platform | 'any'
  rightSideDetail?: JSX.Element | null
}) {
  const { connectWallet, pendingWallet } = useConnectWallet()

  const isPendingConnection = pendingWallet?.id === wallet.id

  const recentConnectorId = useRecentConnectorId()
  const isRecent = Boolean(recentConnectorId && wallet.id === recentConnectorId)

  const themeColors = useSporeColors()
  const icon = getIcon({ wallet, themeColors })
  const text = getConnectorText({ wallet })
  const isDetected = useIsInjectedWallet(wallet.id)
  // TODO(WEB-4173): Remove isIFrame check when we can update wagmi to version >= 2.9.4
  const isDisabled = Boolean(isPendingConnection && !isIFramed())

  const accountDrawer = useAccountDrawer()
  const setMenu = useSetMenu()

  const onSuccess = useEvent(() => {
    accountDrawer.close()
    setMenu({ variant: MenuStateVariant.MAIN })
  })

  const individualPlatform = connectOnPlatform === 'any' ? undefined : connectOnPlatform
  const handleConnect = useEvent(() => connectWallet({ wallet, onSuccess, individualPlatform }))

  return (
    <WalletConnectorOptionBase
      icon={icon}
      text={text}
      rightSideDetail={
        rightSideDetail || (
          <RightSideDetail isPendingConnection={isPendingConnection} isRecent={isRecent} detected={isDetected} />
        )
      }
      onPress={handleConnect}
      isPendingConnection={isPendingConnection}
      isDisabled={isDisabled}
      analyticsProperties={{
        wallet_name: wallet.name,
        wallet_type: wallet.analyticsWalletType,
      }}
    />
  )
}

export function OtherWalletsOption({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation()

  return (
    <WalletConnectorOptionBase
      icon={<OtherWalletsIcon />}
      text={t('wallet.other')}
      rightSideDetail={<Chevron rotate="180deg" size="$icon.24" color="$neutral3" />}
      onPress={onPress}
      isPendingConnection={false}
      isDisabled={false}
      analyticsProperties={{ wallet_name: 'OTHER_WALLETS', wallet_type: 'OTHER_WALLETS' }}
    />
  )
}

function WalletConnectorOptionBase({
  icon,
  text,
  rightSideDetail,
  onPress,
  isPendingConnection,
  isDisabled,
  analyticsProperties,
}: {
  icon: JSX.Element
  text: string | undefined
  rightSideDetail: JSX.Element | null
  onPress: () => void
  isPendingConnection: boolean
  isDisabled: boolean
  analyticsProperties: {
    wallet_name: string
    wallet_type: string
  }
}) {
  return (
    <Trace
      logPress
      eventOnTrigger={InterfaceEventName.WalletSelected}
      properties={analyticsProperties}
      element={ElementName.WalletTypeOption}
    >
      <Flex
        backgroundColor="$surface2"
        row
        alignItems="center"
        width="100%"
        justifyContent="space-between"
        position="relative"
        px="$spacing12"
        py="$spacing18"
        cursor={isDisabled ? 'auto' : 'pointer'}
        hoverStyle={{ backgroundColor: isDisabled ? '$surface2' : '$surface2Hovered' }}
        opacity={isDisabled && !isPendingConnection ? 0.5 : 1}
        onPress={onPress}
      >
        <Flex row alignItems="center" gap="$gap12">
          {icon}
          <Text variant="body2" py="$spacing8">
            {text}
          </Text>
        </Flex>
        {rightSideDetail}
      </Flex>
    </Trace>
  )
}
