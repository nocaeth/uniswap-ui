import { Link } from 'react-router'
import { GetHelpButtonUI } from 'uniswap/src/components/dialog/GetHelpButtonUI'
import type { GetHelpHeaderProps } from 'uniswap/src/components/dialog/GetHelpHeader'
import { type GetHelpButtonProps, GetHelpHeaderContent } from 'uniswap/src/components/dialog/GetHelpHeaderContent'

// No NOCA support portal yet: only render the help link when a specific article URL is provided
// (previously this fell back to the Uniswap help home).
function WebGetHelpButton({ url }: GetHelpButtonProps): JSX.Element | null {
  if (!url) {
    return null
  }
  return (
    <Link to={url} style={{ textDecoration: 'none' }} target="_blank">
      <GetHelpButtonUI
        width="max-content"
        animation="fast"
        hoverStyle={{
          backgroundColor: '$surface3Hovered',
        }}
        $platform-web={{
          width: 'fit-content',
        }}
      />
    </Link>
  )
}

export function GetHelpHeader(props: GetHelpHeaderProps): JSX.Element {
  return <GetHelpHeaderContent {...props} GetHelpButton={WebGetHelpButton} backArrowHoverColor="$neutral2Hovered" />
}
