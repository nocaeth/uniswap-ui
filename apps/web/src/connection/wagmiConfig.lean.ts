import { isE2eTestEnv } from '@universe/environment'
import type { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { GNOSIS_CHAIN_INFO } from 'uniswap/src/features/chains/evm/info/gnosis'
import { isTestnetChain } from 'uniswap/src/features/chains/utils'
import { logger } from 'utilities/src/logger/logger'
import type { Chain } from 'viem'
import { createClient } from 'viem'
import type { Config, CreateConnectorFn } from 'wagmi'
import { createConfig, fallback, http } from 'wagmi'
import { injected, safe } from 'wagmi/connectors'
import { PLAYWRIGHT_CONNECT_ADDRESS } from '~/connection/constants'
import { createRejectableMockConnector } from '~/connection/rejectableConnector'

const GNOSIS_CHAINS = [GNOSIS_CHAIN_INFO] as const

// Only accept Safe Apps SDK messages from the canonical Safe web app.
export const SAFE_ALLOWED_ORIGIN = /^https:\/\/app\.safe\.global$/

export function isGnosisLeanBuild(): boolean {
  return true
}

export const orderedTransportUrls = (chain: ReturnType<typeof getChainInfo>): string[] => {
  const orderedRpcUrls = [
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    ...(chain.rpcUrls.interface?.http ?? []),
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    ...(chain.rpcUrls.default?.http ?? []),
    ...(chain.rpcUrls.public?.http ?? []),
    ...(chain.rpcUrls.fallback?.http ?? []),
  ]

  return Array.from(new Set(orderedRpcUrls.filter(Boolean)))
}

export function createWagmiConnectors(params: {
  /** If `true`, appends the wagmi `mock` connector. Used in Playwright. */
  includeMockConnector: boolean
}): CreateConnectorFn[] {
  const baseConnectors = [
    injected(),
    safe({
      allowedDomains: [SAFE_ALLOWED_ORIGIN],
    }),
  ]

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
