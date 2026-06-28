import { Interface } from '@ethersproject/abi'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type { GnosisAggregationQuote } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter'
import {
  GNOSIS_CURVE_GNO_OSGNO_POOL,
  GNOSIS_CURVE_USDCE_SDAI_POOL,
  GNOSIS_GNO,
  GNOSIS_OSGNO,
  GNOSIS_SDAI,
  GNOSIS_USDC,
  GNOSIS_USDCE,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'

const ROUTER = '0x9999999999999999999999999999999999999999'
const CURVE = '0x8888888888888888888888888888888888888888'
const SWAPPER = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x2222222222222222222222222222222222222222'

describe('Gnosis aggregation router helpers', () => {
  afterEach(() => {
    vi.doUnmock('uniswap/src/features/transactions/swap/services/gnosisRouter/constants')
    vi.resetModules()
  })

  it('builds the curated Curve x3pool route tuple and stable-swap params', async () => {
    const { getGnosisCurveX3PoolRoute, getGnosisCurveRouteHash } =
      await import('uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter')
    const spec = getGnosisCurveX3PoolRoute({ tokenIn: GNOSIS_USDC, tokenOut: GNOSIS_WXDAI })

    expect(spec?.route[0]).toBe(GNOSIS_USDC)
    expect(spec?.route[2]).toBe(GNOSIS_WXDAI)
    expect(spec?.swapParams[0]).toEqual(['1', '0', '1', '1', '3'])
    expect(spec ? getGnosisCurveRouteHash(spec) : '').toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('builds curated direct Curve route tuples for USDC.e/sDAI and GNO/osGNO', async () => {
    const { getGnosisCurveDirectPoolRoute, getGnosisCurveRouteHash } =
      await import('uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter')

    const usdceToSdai = getGnosisCurveDirectPoolRoute({ tokenIn: GNOSIS_USDCE, tokenOut: GNOSIS_SDAI })
    expect(usdceToSdai?.route[1]).toBe(GNOSIS_CURVE_USDCE_SDAI_POOL)
    expect(usdceToSdai?.swapParams[0]).toEqual(['0', '1', '1', '1', '2'])
    expect(usdceToSdai ? getGnosisCurveRouteHash(usdceToSdai) : '').toMatch(/^0x[0-9a-f]{64}$/)

    const osgnoToGno = getGnosisCurveDirectPoolRoute({ tokenIn: GNOSIS_OSGNO, tokenOut: GNOSIS_GNO })
    expect(osgnoToGno?.route[1]).toBe(GNOSIS_CURVE_GNO_OSGNO_POOL)
    expect(osgnoToGno?.swapParams[0]).toEqual(['1', '0', '1', '1', '2'])
    expect(osgnoToGno ? getGnosisCurveRouteHash(osgnoToGno) : '').toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('encodes aggregation execute calldata from quote payload legs', async () => {
    vi.resetModules()
    vi.doMock('uniswap/src/features/transactions/swap/services/gnosisRouter/constants', async () => ({
      ...(await vi.importActual('uniswap/src/features/transactions/swap/services/gnosisRouter/constants')),
      GNOSIS_AGGREGATION_ROUTER_ADDRESS: ROUTER,
      GNOSIS_CURVE_ROUTER_ADDRESS: CURVE,
    }))

    const {
      GNOSIS_AGGREGATION_QUOTE_ID,
      GnosisAggregationStepType,
      GnosisTransmuteDirection,
      aggregationRouterInterface,
      buildGnosisAggregationTransaction,
      encodeGnosisAggregationTransmuteStepData,
    } = await import('uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter')

    const quote = {
      chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      swapper: SWAPPER,
      input: { token: GNOSIS_USDCE, amount: '1000' },
      output: { token: GNOSIS_USDC, amount: '1000', minimumAmount: '995', recipient: RECIPIENT },
      tradeType: TradingApi.TradeType.EXACT_INPUT,
      slippage: 0.5,
      route: [],
      routeString: 'USDC.e->USDC transmuter',
      quoteId: GNOSIS_AGGREGATION_QUOTE_ID,
      gasUseEstimate: '165000',
      priceImpact: 0,
      portionBips: 0,
      aggregation: {
        tokenIn: GNOSIS_USDCE,
        tokenOut: GNOSIS_USDC,
        legs: [
          {
            amountIn: '1000',
            label: 'USDC.e->USDC transmuter',
            steps: [
              {
                stepType: GnosisAggregationStepType.Transmute,
                data: encodeGnosisAggregationTransmuteStepData(GnosisTransmuteDirection.UsdceToUsdc),
              },
            ],
          },
        ],
      },
    } as GnosisAggregationQuote

    const tx = buildGnosisAggregationTransaction({ quote, deadline: 1_700_000_000 })
    expect(tx?.to).toBe(ROUTER)
    expect(tx?.from).toBe(SWAPPER)
    expect(tx?.value).toBe('0x0')

    const decoded = aggregationRouterInterface.decodeFunctionData('execute', tx?.data ?? '0x')
    expect(decoded[0]).toBe(GNOSIS_USDCE)
    expect(decoded[1].toString()).toBe('1000')
    expect(decoded[2]).toBe(GNOSIS_USDC)
    expect(decoded[3].toString()).toBe('995')
    expect(decoded[4]).toBe(RECIPIENT)
    expect(decoded[5].toString()).toBe('1700000000')
    expect(decoded[6][0].amountIn.toString()).toBe('1000')

    // Keep the imported Interface type live so this test fails if the ABI stops being ethers-compatible.
    expect(aggregationRouterInterface).toBeInstanceOf(Interface)
  })

  it('rejects aggregation calldata when payload tokens differ from the quote tokens', async () => {
    vi.resetModules()
    vi.doMock('uniswap/src/features/transactions/swap/services/gnosisRouter/constants', async () => ({
      ...(await vi.importActual('uniswap/src/features/transactions/swap/services/gnosisRouter/constants')),
      GNOSIS_AGGREGATION_ROUTER_ADDRESS: ROUTER,
      GNOSIS_CURVE_ROUTER_ADDRESS: CURVE,
    }))

    const {
      GNOSIS_AGGREGATION_QUOTE_ID,
      GnosisAggregationStepType,
      GnosisTransmuteDirection,
      buildGnosisAggregationTransaction,
      encodeGnosisAggregationTransmuteStepData,
    } = await import('uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter')

    const quote = {
      chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      swapper: SWAPPER,
      input: { token: GNOSIS_USDCE, amount: '1000' },
      output: { token: GNOSIS_USDC, amount: '1000', minimumAmount: '995', recipient: RECIPIENT },
      tradeType: TradingApi.TradeType.EXACT_INPUT,
      slippage: 0.5,
      route: [],
      routeString: 'USDC.e->USDC transmuter',
      quoteId: GNOSIS_AGGREGATION_QUOTE_ID,
      gasUseEstimate: '165000',
      priceImpact: 0,
      portionBips: 0,
      aggregation: {
        tokenIn: GNOSIS_WXDAI,
        tokenOut: GNOSIS_USDC,
        legs: [
          {
            amountIn: '1000',
            label: 'USDC.e->USDC transmuter',
            steps: [
              {
                stepType: GnosisAggregationStepType.Transmute,
                data: encodeGnosisAggregationTransmuteStepData(GnosisTransmuteDirection.UsdceToUsdc),
              },
            ],
          },
        ],
      },
    } as GnosisAggregationQuote

    expect(() => buildGnosisAggregationTransaction({ quote })).toThrow(
      'Malformed Gnosis aggregation quote: top-level and aggregation tokens differ',
    )
  })

  it('rejects aggregation calldata when leg input does not sum to quote input', async () => {
    vi.resetModules()
    vi.doMock('uniswap/src/features/transactions/swap/services/gnosisRouter/constants', async () => ({
      ...(await vi.importActual('uniswap/src/features/transactions/swap/services/gnosisRouter/constants')),
      GNOSIS_AGGREGATION_ROUTER_ADDRESS: ROUTER,
      GNOSIS_CURVE_ROUTER_ADDRESS: CURVE,
    }))

    const {
      GNOSIS_AGGREGATION_QUOTE_ID,
      GnosisAggregationStepType,
      GnosisTransmuteDirection,
      buildGnosisAggregationTransaction,
      encodeGnosisAggregationTransmuteStepData,
    } = await import('uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter')

    const quote = {
      chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      swapper: SWAPPER,
      input: { token: GNOSIS_USDCE, amount: '1000' },
      output: { token: GNOSIS_USDC, amount: '1000', minimumAmount: '995', recipient: RECIPIENT },
      tradeType: TradingApi.TradeType.EXACT_INPUT,
      slippage: 0.5,
      route: [],
      routeString: 'USDC.e->USDC transmuter',
      quoteId: GNOSIS_AGGREGATION_QUOTE_ID,
      gasUseEstimate: '165000',
      priceImpact: 0,
      portionBips: 0,
      aggregation: {
        tokenIn: GNOSIS_USDCE,
        tokenOut: GNOSIS_USDC,
        legs: [
          {
            amountIn: '999',
            label: 'USDC.e->USDC transmuter',
            steps: [
              {
                stepType: GnosisAggregationStepType.Transmute,
                data: encodeGnosisAggregationTransmuteStepData(GnosisTransmuteDirection.UsdceToUsdc),
              },
            ],
          },
        ],
      },
    } as GnosisAggregationQuote

    expect(() => buildGnosisAggregationTransaction({ quote })).toThrow(
      'Malformed Gnosis aggregation quote: leg input sum does not match quote input amount',
    )
  })

  it('fails closed when the output minimum is missing or zero (never a zero floor)', async () => {
    vi.resetModules()
    vi.doMock('uniswap/src/features/transactions/swap/services/gnosisRouter/constants', async () => ({
      ...(await vi.importActual('uniswap/src/features/transactions/swap/services/gnosisRouter/constants')),
      GNOSIS_AGGREGATION_ROUTER_ADDRESS: ROUTER,
      GNOSIS_CURVE_ROUTER_ADDRESS: CURVE,
    }))

    const {
      GNOSIS_AGGREGATION_QUOTE_ID,
      GnosisAggregationStepType,
      GnosisTransmuteDirection,
      buildGnosisAggregationTransaction,
      encodeGnosisAggregationTransmuteStepData,
    } = await import('uniswap/src/features/transactions/swap/services/gnosisRouter/aggregationRouter')

    const baseQuote = {
      chainId: UniverseChainId.Gnosis as unknown as TradingApi.ChainId,
      swapper: SWAPPER,
      input: { token: GNOSIS_USDCE, amount: '1000' },
      tradeType: TradingApi.TradeType.EXACT_INPUT,
      slippage: 0.5,
      route: [],
      routeString: 'USDC.e->USDC transmuter',
      quoteId: GNOSIS_AGGREGATION_QUOTE_ID,
      gasUseEstimate: '165000',
      priceImpact: 0,
      portionBips: 0,
      aggregation: {
        tokenIn: GNOSIS_USDCE,
        tokenOut: GNOSIS_USDC,
        legs: [
          {
            amountIn: '1000',
            label: 'USDC.e->USDC transmuter',
            steps: [
              {
                stepType: GnosisAggregationStepType.Transmute,
                data: encodeGnosisAggregationTransmuteStepData(GnosisTransmuteDirection.UsdceToUsdc),
              },
            ],
          },
        ],
      },
    }

    // Neither minimumAmount nor amount present -> no usable floor.
    const missing = { ...baseQuote, output: { token: GNOSIS_USDC, recipient: RECIPIENT } } as GnosisAggregationQuote
    expect(() => buildGnosisAggregationTransaction({ quote: missing })).toThrow(
      'Malformed Gnosis aggregation quote: missing output minimum amount',
    )

    // Explicit zero floor -> stripped all slippage protection.
    const zero = {
      ...baseQuote,
      output: { token: GNOSIS_USDC, amount: '1000', minimumAmount: '0', recipient: RECIPIENT },
    } as GnosisAggregationQuote
    expect(() => buildGnosisAggregationTransaction({ quote: zero })).toThrow(
      'Malformed Gnosis aggregation quote: output minimum amount is zero',
    )
  })
})
