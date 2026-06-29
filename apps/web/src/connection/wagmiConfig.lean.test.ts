import { createWagmiConfig, createWagmiConnectors, isGnosisLeanBuild } from '~/connection/wagmiConfig.lean'

function connectorIds(params: { includeMockConnector: boolean }): string[] {
  return createWagmiConfig({
    connectors: createWagmiConnectors(params),
  }).connectors.map((connector) => connector.id)
}

describe('lean createWagmiConnectors', () => {
  it('uses only injected and Safe connectors', () => {
    expect(isGnosisLeanBuild()).toBe(true)
    expect(connectorIds({ includeMockConnector: false })).toEqual(['injected', 'safe'])
  })

  it('keeps the mock connector for e2e', () => {
    expect(connectorIds({ includeMockConnector: true })).toEqual(['injected', 'safe', 'mock'])
  })
})
