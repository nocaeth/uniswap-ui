import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'
import { defaultResolveRpcConfig } from 'uniswap/src/features/providers/resolveRpcConfig.web'

vi.mock('@universe/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@universe/api')>()
  return {
    ...actual,
    getEntryGatewayUrl: (): string => 'https://entry-gateway.example',
    provideDeviceIdService: (): { getDeviceId: () => Promise<undefined> } => ({
      getDeviceId: async () => undefined,
    }),
    provideSessionStorage: (): { get: () => Promise<undefined> } => ({
      get: async () => undefined,
    }),
  }
})

vi.mock('@universe/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@universe/environment')>()
  return {
    ...actual,
    isE2eTestEnv: (): boolean => false,
    isExtensionApp: false,
    REQUEST_SOURCE: 'test-source',
  }
})

vi.mock('@universe/gating', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@universe/gating')>()
  return {
    ...actual,
    getFeatureFlag: (): boolean => true,
    isStatsigClientRegistered: (): boolean => true,
  }
})

describe('defaultResolveRpcConfig.web', () => {
  it('uses direct configured public RPC for Gnosis instead of UniRPC', () => {
    const result = defaultResolveRpcConfig({ chainId: UniverseChainId.Gnosis, rpcType: RPCType.Public })

    expect(result).toMatchObject({
      rpcUrl: 'https://gnosis.drpc.org',
    })
    expect(result?.isUniRpc).toBeUndefined()
  })

  it('continues to use UniRPC for supported web chains', () => {
    const result = defaultResolveRpcConfig({ chainId: UniverseChainId.Mainnet, rpcType: RPCType.Public })

    expect(result).toMatchObject({
      rpcUrl: 'https://entry-gateway.example/rpc/1',
      isUniRpc: true,
      credentials: 'include',
      headers: { 'x-request-source': 'test-source' },
    })
  })
})
