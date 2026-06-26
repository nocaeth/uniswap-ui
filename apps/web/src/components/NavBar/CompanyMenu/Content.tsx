import type { ReactNode } from 'react'
import { ElementName } from 'uniswap/src/features/telemetry/constants'

// Gnosis-only build: the Uniswap "Products/Protocol/Company" mega-menu content was
// removed along with the Landing page. Only the MenuItem shape is kept — the nav
// Tabs (TabsContent) reuse it for their dropdown items.
export interface MenuItem {
  label: string
  href: string
  internal?: boolean
  overflow?: boolean
  closeMenu?: () => void
  icon?: ReactNode
  body?: string
  elementName: ElementName
}
