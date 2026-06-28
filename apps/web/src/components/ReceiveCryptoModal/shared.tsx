import { PropsWithChildren } from 'react'
import { Flex, ModalCloseIcon, styled, TouchableArea, useSporeColors } from 'ui/src'
import { ReactComponent as ForConnectingBackground } from 'ui/src/assets/backgrounds/for-connecting-v2.svg'
import { ArrowLeft } from 'ui/src/components/icons/ArrowLeft'

export const ContentWrapper = styled(Flex, {
  backgroundColor: '$surface1',
  width: '100%',
  flex: 1,
  position: 'relative',
})

const ConnectingBackgroundImage = styled(ForConnectingBackground, {
  position: 'absolute',
  zIndex: 0,
  width: '100%',
  height: '100%',
})

const ConnectingBackgroundImageFadeLayer = styled(Flex, {
  position: 'absolute',
  zIndex: 1,
  width: '100%',
  height: '100%',
  top: 0,
  left: 0,
})

interface ConnectingViewWrapperProps {
  closeModal?: () => void
  onBack?: () => void
  showDottedBackground?: boolean
}

export function ConnectingViewWrapper({
  children,
  closeModal,
  onBack,
  showDottedBackground = true,
}: PropsWithChildren<ConnectingViewWrapperProps>) {
  const colors = useSporeColors()

  return (
    <Flex gap="$spacing16" position="relative" $sm={{ px: '$spacing8', pb: '$spacing16' }}>
      {showDottedBackground && (
        <>
          <ConnectingBackgroundImage color={colors.neutral2.val} />
          <ConnectingBackgroundImageFadeLayer
            background={`radial-gradient(70% 50% at center, transparent 0%, ${colors.surface1.val} 100%)`}
          />
        </>
      )}
      <Flex flexDirection="row-reverse" alignItems="center" justifyContent="space-between" zIndex={2}>
        {closeModal && <ModalCloseIcon testId="ConnectingViewWrapper-close" onClose={closeModal} />}
        {onBack && (
          <TouchableArea data-testid="ConnectingViewWrapper-back" onPress={onBack}>
            <ArrowLeft color="$neutral2" size="$icon.24" hoverColor="$neutral2Hovered" />
          </TouchableArea>
        )}
      </Flex>
      <Flex mt="$spacing40" zIndex={2} width="100%" height="100%">
        {children}
      </Flex>
    </Flex>
  )
}
