import { isE2eTestEnv } from '@universe/environment'
import { GNOSIS_CHAIN_INFO } from 'uniswap/src/features/chains/evm/info/gnosis'
import { isTestnetChain } from 'uniswap/src/features/chains/utils'
import { logger } from 'utilities/src/logger/logger'
import type { Chain } from 'viem'
import { createClient } from 'viem'
import type { Config, CreateConnectorFn } from 'wagmi'
import { createConfig, fallback, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { PLAYWRIGHT_CONNECT_ADDRESS } from '~/connection/constants'
import { createRejectableMockConnector } from '~/connection/rejectableConnector'
import { orderedTransportUrls } from '~/connection/wagmiConfig.shared'

export { orderedTransportUrls } from '~/connection/wagmiConfig.shared'

const GNOSIS_CHAINS = [GNOSIS_CHAIN_INFO] as const

export function isGnosisLeanBuild(): boolean {
  return true
}

export function createWagmiConnectors(params: {
  /** If `true`, appends the wagmi `mock` connector. Used in Playwright. */
  includeMockConnector: boolean
}): CreateConnectorFn[] {
  const baseConnectors = [injected()]

  return params.includeMockConnector
    ? [
        ...baseConnectors,
        createRejectableMockConnector({
          features: {},
          accounts: [PLAYWRIGHT_CONNECT_ADDRESS],
        }),
      ]
    : baseConnectors
}

export function createWagmiConfig(params: {
  connectors: CreateConnectorFn[]
  // oxlint-disable-next-line max-params -- matches the standard web wagmi config seam.
  onFetchResponse?: (response: Response, chain: Chain, url: string) => void
}): Config<typeof GNOSIS_CHAINS> {
  const { connectors, onFetchResponse = defaultOnFetchResponse } = params

  return createConfig({
    chains: GNOSIS_CHAINS,
    connectors,
    client({ chain }) {
      return createClient({
        chain,
        batch: { multicall: true },
        pollingInterval: 12_000,
        transport: fallback(
          orderedTransportUrls(GNOSIS_CHAIN_INFO).map((url) =>
            http(url, {
              onFetchResponse: (response) => onFetchResponse(response, chain, url),
            }),
          ),
        ),
      })
    },
  })
}

// oxlint-disable-next-line max-params
const defaultOnFetchResponse = (response: Response, chain: Chain, url: string): void => {
  if (response.status === 200) {
    return
  }

  const message = `RPC provider returned non-200 status: ${response.status}`

  if (isTestnetChain(chain.id)) {
    logger.warn('connection/wagmiConfig.lean.ts', 'client', message, {
      extra: {
        chainId: chain.id,
        url,
      },
    })
  } else {
    logger.error(new Error(message), {
      extra: {
        chainId: chain.id,
        url,
      },
      tags: {
        file: 'connection/wagmiConfig.lean.ts',
        function: 'client',
      },
    })
  }
}

const defaultConnectors = createWagmiConnectors({
  includeMockConnector: isE2eTestEnv(),
})

export const wagmiConfig = createWagmiConfig({ connectors: defaultConnectors })
