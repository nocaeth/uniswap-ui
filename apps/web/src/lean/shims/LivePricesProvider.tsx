import type { ReactElement, ReactNode } from 'react'
import { RemotePriceProvider } from 'uniswap/src/features/prices/RemotePriceProvider'

export function LivePricesProvider({ children }: { children: ReactNode }): ReactElement {
  return <RemotePriceProvider>{children}</RemotePriceProvider>
}
