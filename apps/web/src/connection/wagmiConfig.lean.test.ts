import type { CreateConnectorFn } from 'wagmi'
import { createWagmiConnectors, isGnosisLeanBuild } from '~/connection/wagmiConfig.lean'

const connectorConfig = {
  chains: [],
  emitter: {
    emit: vi.fn(),
    listenerCount: vi.fn(() => 0),
    off: vi.fn(),
    on: vi.fn(),
  },
  storage: {
    getItem: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  },
  _internal: {
    transports: new Map(),
  },
} as unknown as Parameters<CreateConnectorFn>[0]

function connectorIds(params: { includeMockConnector: boolean }): string[] {
  return createWagmiConnectors(params).map((connector) => connector(connectorConfig).id)
}

describe('lean createWagmiConnectors', () => {
  it('keeps only the eager injected connector', () => {
    expect(isGnosisLeanBuild()).toBe(true)
    expect(connectorIds({ includeMockConnector: false })).toEqual(['injected'])
  })

  it('keeps the mock connector for e2e', () => {
    expect(connectorIds({ includeMockConnector: true })).toEqual(['injected', 'mock'])
  })
})
