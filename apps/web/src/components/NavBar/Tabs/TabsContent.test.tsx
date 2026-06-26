import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { ElementName } from 'uniswap/src/features/telemetry/constants'
import { useTabsContent } from '~/components/NavBar/Tabs/TabsContent'
import { mocked } from '~/test-utils/mocked'
import { renderHook } from '~/test-utils/render'

vi.mock('@universe/gating', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@universe/gating')>()),
  useFeatureFlag: vi.fn(),
}))

function getTabState(elementName: ElementName): boolean | undefined {
  const { result } = renderHook(() => useTabsContent())
  return result.current.find((tab) => tab.elementName === elementName)?.isActive
}

describe('useTabsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
    mocked(useFeatureFlag).mockReturnValue(false)
  })

  it('exposes the Gnosis-only tabs (Trade, Explore, Pool) and no Portfolio tab', () => {
    const { result } = renderHook(() => useTabsContent())
    const elementNames = result.current.map((tab) => tab.elementName)

    expect(elementNames).toEqual([ElementName.NavbarTradeTab, ElementName.NavbarExploreTab, ElementName.NavbarPoolTab])
  })

  it('keeps Pool active on positions pages', () => {
    window.history.pushState({}, '', '/positions/create/v4')
    expect(getTabState(ElementName.NavbarPoolTab)).toBe(true)
  })

  it('keeps Pool inactive on the swap page', () => {
    window.history.pushState({}, '', '/swap')
    expect(getTabState(ElementName.NavbarPoolTab)).toBe(false)
    expect(getTabState(ElementName.NavbarTradeTab)).toBe(true)
  })
})
