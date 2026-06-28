import { BigNumber } from '@ethersproject/bignumber'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { GNOSIS_SDAI, GNOSIS_USDCE } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import {
  __resetGnosisVeloraForTests,
  buildGnosisVeloraTransaction,
  fetchGnosisVeloraQuote,
  getGnosisVeloraApprovalSpender,
  getGnosisVeloraFallbackQuote,
  GNOSIS_VELORA_AUGUSTUS_ADDRESS,
  GNOSIS_VELORA_QUOTE_ID,
  withGnosisVeloraFallbackQuote,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/velora'

vi.mock('uniswap/src/features/transactions/swap/services/gnosisRouter/provider', () => ({
  getGnosisProvider: vi.fn(),
}))

const SWAPPER = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x2222222222222222222222222222222222222222'
const NATIVE_XDAI_SENTINEL = '0x0000000000000000000000000000000000000000'

function quoteRequest(overrides: Partial<TradingApi.QuoteRequest> = {}): TradingApi.QuoteRequest {
  return {
    type: TradingApi.TradeType.EXACT_INPUT,
    amount: '1000000000000000000',
    tokenInChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
    tokenOutChainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
    tokenIn: NATIVE_XDAI_SENTINEL,
    tokenOut: GNOSIS_USDCE,
    swapper: SWAPPER,
    slippageTolerance: 0.5,
    ...overrides,
  }
}

function priceRoute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blockNumber: 123,
    network: UniverseChainId.Gnosis,
    srcToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    srcDecimals: 18,
    srcAmount: '1000000000000000000',
    destToken: GNOSIS_USDCE.toLowerCase(),
    destDecimals: 6,
    destAmount: '1000000',
    bestRoute: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            destToken: GNOSIS_USDCE.toLowerCase(),
            swapExchanges: [{ exchange: 'CurveV2', percent: 100 }],
          },
        ],
      },
    ],
    gasCost: '455640',
    side: 'SELL',
    version: '6.2',
    contractAddress: GNOSIS_VELORA_AUGUSTUS_ADDRESS,
    tokenTransferProxy: GNOSIS_VELORA_AUGUSTUS_ADDRESS,
    srcUSD: '1.00',
    destUSD: '0.99',
    hmac: 'test-hmac',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('Gnosis Velora integration', () => {
  const provider = {
    getBlockNumber: vi.fn(),
    getGasPrice: vi.fn(),
    call: vi.fn(),
  }
  const fetchMock = vi.fn()

  beforeEach(() => {
    __resetGnosisVeloraForTests()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(getGnosisProvider).mockReturnValue(provider as unknown as ReturnType<typeof getGnosisProvider>)
    provider.getBlockNumber.mockResolvedValue(456)
    provider.getGasPrice.mockResolvedValue(BigNumber.from(10))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches exact-input Gnosis quotes from Velora Market v6.2', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ priceRoute: priceRoute() }))

    const response = await fetchGnosisVeloraQuote(quoteRequest())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string)
    expect(url.pathname).toBe('/prices')
    expect(url.searchParams.get('network')).toBe(String(UniverseChainId.Gnosis))
    expect(url.searchParams.get('version')).toBe('6.2')
    expect(url.searchParams.get('side')).toBe('SELL')
    expect(url.searchParams.get('srcToken')).toBe('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')

    expect(response?.routing).toBe(TradingApi.Routing.CLASSIC)
    if (response?.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected Velora classic quote')
    }
    expect(response.quote.quoteId).toBe(GNOSIS_VELORA_QUOTE_ID)
    expect(response.quote.output?.amount).toBe('1000000')
    expect(response.quote.output?.minimumAmount).toBe('995000')
    expect(response.quote.gasFee).toBe('4556400')
  })

  it('skips exact-output quotes so they stay on the local router', async () => {
    const response = await fetchGnosisVeloraQuote(
      quoteRequest({
        type: TradingApi.TradeType.EXACT_OUTPUT,
        amount: '1000000',
      }),
    )

    expect(response).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cools down after a Velora 429 without throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errorType: 'RateLimit' }, 429, { 'Retry-After': '60' }))

    await expect(fetchGnosisVeloraQuote(quoteRequest())).resolves.toBeUndefined()
    await expect(fetchGnosisVeloraQuote(quoteRequest({ amount: '2000000000000000000' }))).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('extracts the Velora spender for ERC20 approvals', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        priceRoute: priceRoute({
          srcToken: GNOSIS_SDAI.toLowerCase(),
          srcDecimals: 18,
          srcAmount: '1000000000000000000',
        }),
      }),
    )

    const response = await fetchGnosisVeloraQuote(
      quoteRequest({
        tokenIn: GNOSIS_SDAI,
      }),
    )

    expect(getGnosisVeloraApprovalSpender(response)).toBe(GNOSIS_VELORA_AUGUSTUS_ADDRESS)
  })

  it('carries a local fallback quote for transaction-build failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ priceRoute: priceRoute() }))

    const response = await fetchGnosisVeloraQuote(quoteRequest())
    if (response?.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected Velora classic quote')
    }

    const fallbackQuote = { ...response.quote, quoteId: 'gnosis-local' } as TradingApi.ClassicQuote
    delete (fallbackQuote as { velora?: unknown }).velora

    const responseWithFallback = withGnosisVeloraFallbackQuote(response, fallbackQuote)
    if (responseWithFallback.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected Velora classic quote')
    }

    expect(getGnosisVeloraFallbackQuote(responseWithFallback.quote)?.quoteId).toBe('gnosis-local')
  })

  it('builds Velora transactions with the cached priceRoute and receiver', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ priceRoute: priceRoute() })).mockResolvedValueOnce(
      jsonResponse({
        from: SWAPPER,
        to: GNOSIS_VELORA_AUGUSTUS_ADDRESS,
        value: '0',
        data: '0x1234',
        gasPrice: '10',
        chainId: UniverseChainId.Gnosis,
      }),
    )

    const response = await fetchGnosisVeloraQuote(quoteRequest({ recipient: RECIPIENT }))
    if (response?.routing !== TradingApi.Routing.CLASSIC) {
      throw new Error('Expected Velora classic quote')
    }

    const tx = await buildGnosisVeloraTransaction({ quote: response.quote, deadline: 999 })

    expect(tx).toEqual({
      from: SWAPPER,
      to: GNOSIS_VELORA_AUGUSTUS_ADDRESS,
      value: '0',
      data: '0x1234',
      gasPrice: '10',
      chainId: UniverseChainId.Gnosis,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const transactionUrl = new URL(fetchMock.mock.calls[1]?.[0] as string)
    expect(transactionUrl.pathname).toBe('/transactions/100')
    expect(transactionUrl.searchParams.get('ignoreChecks')).toBe('true')
    expect(transactionUrl.searchParams.get('ignoreGasEstimate')).toBe('true')

    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body['priceRoute']).toEqual(priceRoute())
    expect(body['slippage']).toBe(50)
    expect(body['receiver']).toBe(RECIPIENT)
    expect(body['deadline']).toBe(999)
  })
})
