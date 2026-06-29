import { defaultAbiCoder, Interface } from '@ethersproject/abi'
import { BigNumber, type BigNumberish } from '@ethersproject/bignumber'
import { keccak256 } from '@ethersproject/keccak256'
import type { TransactionRequest } from '@ethersproject/providers'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_AGGREGATION_ROUTER_ADDRESS,
  GNOSIS_CURVE_EURE_X3CRV_POOL,
  GNOSIS_CURVE_GNO_OSGNO_POOL,
  GNOSIS_CURVE_ROUTER_ADDRESS,
  GNOSIS_CURVE_USDCE_SDAI_POOL,
  GNOSIS_CURVE_XDAI_USDC_USDT_POOL,
  GNOSIS_CURVE_X3CRV_TOKEN,
  GNOSIS_EURE_V1,
  GNOSIS_GNO,
  GNOSIS_OSGNO,
  GNOSIS_SDAI,
  GNOSIS_USDC,
  GNOSIS_USDCE,
  GNOSIS_USDT,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const NATIVE_ADDRESS_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const AGGREGATION_DEADLINE_SECONDS = 60 * 30
const CURVE_STABLE_SWAP_TYPE = 1
const CURVE_ADD_LIQUIDITY_SWAP_TYPE = 4
const CURVE_REMOVE_LIQUIDITY_SWAP_TYPE = 6
const CURVE_STABLE_POOL_TYPE = 1
const CURVE_CRYPTO_POOL_TYPE = 2
const CURVE_X3_N_COINS = 3
const CURVE_TWO_COIN_N_COINS = 2

export const GNOSIS_AGGREGATION_QUOTE_ID = 'gnosis-aggregation'

export enum GnosisAggregationStepType {
  V3 = 0,
  Curve = 1,
  Transmute = 2,
}

export enum GnosisTransmuteDirection {
  UsdcToUsdce = 0,
  UsdceToUsdc = 1,
}

export interface GnosisAggregationStep {
  stepType: GnosisAggregationStepType
  data: string
}

export interface GnosisAggregationLeg {
  amountIn: string
  steps: GnosisAggregationStep[]
  label: string
}

export interface GnosisAggregationPayload {
  tokenIn: string
  tokenOut: string
  legs: GnosisAggregationLeg[]
}

export type GnosisAggregationQuote = TradingApi.ClassicQuote & {
  aggregation: GnosisAggregationPayload
}

export interface GnosisCurveRouteSpec {
  label: string
  route: string[]
  swapParams: string[][]
  pools: string[]
}

interface GnosisCurveDirectPoolConfig {
  label: string
  pool: string
  tokens: readonly string[]
  poolType: number
  nCoins: number
}

const DIRECT_CURVE_POOLS: readonly GnosisCurveDirectPoolConfig[] = [
  {
    label: 'Curve x3pool',
    pool: GNOSIS_CURVE_XDAI_USDC_USDT_POOL,
    tokens: [GNOSIS_WXDAI, GNOSIS_USDC, GNOSIS_USDT],
    poolType: CURVE_STABLE_POOL_TYPE,
    nCoins: CURVE_X3_N_COINS,
  },
  {
    label: 'Curve USDC.e/sDAI',
    pool: GNOSIS_CURVE_USDCE_SDAI_POOL,
    tokens: [GNOSIS_USDCE, GNOSIS_SDAI],
    poolType: CURVE_STABLE_POOL_TYPE,
    nCoins: CURVE_TWO_COIN_N_COINS,
  },
  {
    label: 'Curve GNO/osGNO',
    pool: GNOSIS_CURVE_GNO_OSGNO_POOL,
    tokens: [GNOSIS_GNO, GNOSIS_OSGNO],
    poolType: CURVE_STABLE_POOL_TYPE,
    nCoins: CURVE_TWO_COIN_N_COINS,
  },
]

const EURE_USD_X3POOL_TOKEN_INDICES = new Map<string, number>([
  [GNOSIS_WXDAI.toLowerCase(), 0],
  [GNOSIS_USDC.toLowerCase(), 1],
  [GNOSIS_USDT.toLowerCase(), 2],
])

export const AGGREGATION_ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenIn', type: 'address' },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address', name: 'tokenOut', type: 'address' },
      { internalType: 'uint256', name: 'minAmountOut', type: 'uint256' },
      { internalType: 'address', name: 'recipient', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      {
        components: [
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          {
            components: [
              { internalType: 'enum GnosisAggregationRouter.StepType', name: 'stepType', type: 'uint8' },
              { internalType: 'bytes', name: 'data', type: 'bytes' },
            ],
            internalType: 'struct GnosisAggregationRouter.Step[]',
            name: 'steps',
            type: 'tuple[]',
          },
        ],
        internalType: 'struct GnosisAggregationRouter.Leg[]',
        name: 'legs',
        type: 'tuple[]',
      },
    ],
    name: 'execute',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export const CURVE_ROUTER_NG_ABI = [
  {
    inputs: [
      { internalType: 'address[11]', name: '_route', type: 'address[11]' },
      { internalType: 'uint256[5][5]', name: '_swap_params', type: 'uint256[5][5]' },
      { internalType: 'uint256', name: '_amount', type: 'uint256' },
      { internalType: 'address[5]', name: '_pools', type: 'address[5]' },
    ],
    name: 'get_dy',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const USDC_TRANSMUTER_ABI = [
  {
    inputs: [],
    name: 'isEnabled',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export const aggregationRouterInterface = new Interface(AGGREGATION_ROUTER_ABI)
export const curveRouterInterface = new Interface(CURVE_ROUTER_NG_ABI)
export const usdcTransmuterInterface = new Interface(USDC_TRANSMUTER_ABI)

function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS
}

function isSameGnosisAddress(a: string | undefined, b: string): boolean {
  if (!a) {
    return false
  }
  return areAddressesEqual({
    addressInput1: { address: a, chainId: UniverseChainId.Gnosis },
    addressInput2: { address: b, chainId: UniverseChainId.Gnosis },
  })
}

export function isGnosisAggregationEnabled(): boolean {
  return !isZeroAddress(GNOSIS_AGGREGATION_ROUTER_ADDRESS) && !isZeroAddress(GNOSIS_CURVE_ROUTER_ADDRESS)
}

export function isGnosisAggregationQuote(quote: TradingApi.ClassicQuote): quote is GnosisAggregationQuote {
  const candidate = quote as TradingApi.ClassicQuote & { aggregation?: { legs?: unknown } }
  return (
    quote.quoteId === GNOSIS_AGGREGATION_QUOTE_ID &&
    Array.isArray(candidate.aggregation?.legs) &&
    candidate.aggregation.legs.length > 0
  )
}

export function getGnosisAggregationApprovalSpender(quoteId: string | undefined): string | undefined {
  return quoteId === GNOSIS_AGGREGATION_QUOTE_ID && !isZeroAddress(GNOSIS_AGGREGATION_ROUTER_ADDRESS)
    ? GNOSIS_AGGREGATION_ROUTER_ADDRESS
    : undefined
}

function isNativeLikeAddress(address: string | undefined): boolean {
  if (!address) {
    return false
  }
  const normalized = address.toLowerCase()
  return normalized === ZERO_ADDRESS || normalized === NATIVE_ADDRESS_SENTINEL
}

export function getGnosisTransmuteDirection(args: {
  tokenIn: string | undefined
  tokenOut: string | undefined
}): GnosisTransmuteDirection | undefined {
  if (isSameGnosisAddress(args.tokenIn, GNOSIS_USDC) && isSameGnosisAddress(args.tokenOut, GNOSIS_USDCE)) {
    return GnosisTransmuteDirection.UsdcToUsdce
  }
  if (isSameGnosisAddress(args.tokenIn, GNOSIS_USDCE) && isSameGnosisAddress(args.tokenOut, GNOSIS_USDC)) {
    return GnosisTransmuteDirection.UsdceToUsdc
  }
  return undefined
}

export function encodeGnosisAggregationV3StepData(args: { path: string; amountOutMinimum: BigNumberish }): string {
  return defaultAbiCoder.encode(['bytes', 'uint256'], [args.path, args.amountOutMinimum])
}

export function encodeGnosisAggregationCurveStepData(args: {
  route: readonly string[]
  swapParams: readonly (readonly BigNumberish[])[]
  pools: readonly string[]
  amountOutMinimum: BigNumberish
}): string {
  return defaultAbiCoder.encode(
    ['address[11]', 'uint256[5][5]', 'address[5]', 'uint256'],
    [args.route, args.swapParams, args.pools, args.amountOutMinimum],
  )
}

export function encodeGnosisAggregationTransmuteStepData(direction: GnosisTransmuteDirection): string {
  return defaultAbiCoder.encode(['uint8'], [direction])
}

export function getGnosisCurveRouteHash(args: {
  route: readonly string[]
  swapParams: readonly (readonly BigNumberish[])[]
  pools: readonly string[]
}): string {
  return keccak256(
    defaultAbiCoder.encode(['address[11]', 'uint256[5][5]', 'address[5]'], [args.route, args.swapParams, args.pools]),
  )
}

export function getGnosisCurveX3PoolRoute(args: {
  tokenIn: string
  tokenOut: string
}): GnosisCurveRouteSpec | undefined {
  return getGnosisCurveDirectPoolRoute({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    pool: GNOSIS_CURVE_XDAI_USDC_USDT_POOL,
  })
}

export function getGnosisCurveDirectPoolRoute(args: {
  tokenIn: string
  tokenOut: string
  pool?: string
}): GnosisCurveRouteSpec | undefined {
  const directPool = DIRECT_CURVE_POOLS.find(
    (candidate) => !args.pool || isSameGnosisAddress(candidate.pool, args.pool),
  )
  const candidates = args.pool ? (directPool ? [directPool] : []) : DIRECT_CURVE_POOLS

  for (const candidate of candidates) {
    const indexByToken = new Map(candidate.tokens.map((token, index) => [token.toLowerCase(), index]))
    const i = indexByToken.get(args.tokenIn.toLowerCase())
    const j = indexByToken.get(args.tokenOut.toLowerCase())
    if (i === undefined || j === undefined || i === j) {
      continue
    }

    const route = Array.from({ length: 11 }, () => ZERO_ADDRESS)
    route[0] = args.tokenIn
    route[1] = candidate.pool
    route[2] = args.tokenOut

    const swapParams = Array.from({ length: 5 }, () => ['0', '0', '0', '0', '0'])
    swapParams[0] = [
      String(i),
      String(j),
      String(CURVE_STABLE_SWAP_TYPE),
      String(candidate.poolType),
      String(candidate.nCoins),
    ]

    return {
      label: `${candidate.label} ${args.tokenIn}->${args.tokenOut}`,
      route,
      swapParams,
      pools: Array.from({ length: 5 }, () => ZERO_ADDRESS),
    }
  }

  return undefined
}

export function getGnosisCurveEureUsdRoute(args: {
  tokenIn: string
  tokenOut: string
}): GnosisCurveRouteSpec | undefined {
  const x3InputIndex = EURE_USD_X3POOL_TOKEN_INDICES.get(args.tokenIn.toLowerCase())
  if (x3InputIndex !== undefined && isSameGnosisAddress(args.tokenOut, GNOSIS_EURE_V1)) {
    const route = Array.from({ length: 11 }, () => ZERO_ADDRESS)
    route[0] = args.tokenIn
    route[1] = GNOSIS_CURVE_XDAI_USDC_USDT_POOL
    route[2] = GNOSIS_CURVE_X3CRV_TOKEN
    route[3] = GNOSIS_CURVE_EURE_X3CRV_POOL
    route[4] = GNOSIS_EURE_V1

    const swapParams = Array.from({ length: 5 }, () => ['0', '0', '0', '0', '0'])
    swapParams[0] = [
      String(x3InputIndex),
      '0',
      String(CURVE_ADD_LIQUIDITY_SWAP_TYPE),
      String(CURVE_STABLE_POOL_TYPE),
      String(CURVE_X3_N_COINS),
    ]
    swapParams[1] = [
      '1',
      '0',
      String(CURVE_STABLE_SWAP_TYPE),
      String(CURVE_CRYPTO_POOL_TYPE),
      String(CURVE_TWO_COIN_N_COINS),
    ]

    return {
      label: `Curve eureusd ${args.tokenIn}->${GNOSIS_EURE_V1}`,
      route,
      swapParams,
      pools: Array.from({ length: 5 }, () => ZERO_ADDRESS),
    }
  }

  const x3OutputIndex = EURE_USD_X3POOL_TOKEN_INDICES.get(args.tokenOut.toLowerCase())
  if (isSameGnosisAddress(args.tokenIn, GNOSIS_EURE_V1) && x3OutputIndex !== undefined) {
    const route = Array.from({ length: 11 }, () => ZERO_ADDRESS)
    route[0] = GNOSIS_EURE_V1
    route[1] = GNOSIS_CURVE_EURE_X3CRV_POOL
    route[2] = GNOSIS_CURVE_X3CRV_TOKEN
    route[3] = GNOSIS_CURVE_XDAI_USDC_USDT_POOL
    route[4] = args.tokenOut

    const swapParams = Array.from({ length: 5 }, () => ['0', '0', '0', '0', '0'])
    swapParams[0] = [
      '0',
      '1',
      String(CURVE_STABLE_SWAP_TYPE),
      String(CURVE_CRYPTO_POOL_TYPE),
      String(CURVE_TWO_COIN_N_COINS),
    ]
    swapParams[1] = [
      '0',
      String(x3OutputIndex),
      String(CURVE_REMOVE_LIQUIDITY_SWAP_TYPE),
      String(CURVE_STABLE_POOL_TYPE),
      String(CURVE_X3_N_COINS),
    ]

    return {
      label: `Curve eureusd ${GNOSIS_EURE_V1}->${args.tokenOut}`,
      route,
      swapParams,
      pools: Array.from({ length: 5 }, () => ZERO_ADDRESS),
    }
  }

  return undefined
}

export function buildGnosisAggregationTransaction(args: {
  quote: TradingApi.ClassicQuote
  deadline?: number
}): TransactionRequest | undefined {
  const { quote } = args
  if (!isGnosisAggregationQuote(quote)) {
    return undefined
  }
  if (isZeroAddress(GNOSIS_AGGREGATION_ROUTER_ADDRESS)) {
    throw new Error(
      'GNOSIS_AGGREGATION_ROUTER_ADDRESS is not set. Deploy GnosisAggregationRouter and set REACT_APP_GNOSIS_AGGREGATION_ROUTER_ADDRESS.',
    )
  }
  if (quote.tradeType !== TradingApi.TradeType.EXACT_INPUT) {
    throw new Error('Gnosis aggregation router supports exact-input swaps only')
  }

  const amountIn = BigNumber.from(quote.input?.amount ?? '0')
  const topLevelTokenIn = quote.input?.token
  const topLevelTokenOut = quote.output?.token
  if (
    !topLevelTokenIn ||
    !topLevelTokenOut ||
    !isSameGnosisAddress(topLevelTokenIn, quote.aggregation.tokenIn) ||
    !isSameGnosisAddress(topLevelTokenOut, quote.aggregation.tokenOut)
  ) {
    throw new Error('Malformed Gnosis aggregation quote: top-level and aggregation tokens differ')
  }
  if (isNativeLikeAddress(quote.aggregation.tokenIn) || isNativeLikeAddress(quote.aggregation.tokenOut)) {
    throw new Error('Gnosis aggregation router does not support native xDAI inputs or outputs')
  }
  const legSum = quote.aggregation.legs.reduce((sum, leg) => sum.add(BigNumber.from(leg.amountIn)), BigNumber.from(0))
  if (!legSum.eq(amountIn)) {
    throw new Error('Malformed Gnosis aggregation quote: leg input sum does not match quote input amount')
  }
  if (quote.aggregation.legs.some((leg) => BigNumber.from(leg.amountIn).isZero() || leg.steps.length === 0)) {
    throw new Error('Malformed Gnosis aggregation quote: every leg must have positive input and at least one step')
  }

  // Fail closed: never ship a zero floor. The deployed router enforces only this absolute
  // amountOutMinimum, so a missing/zero value would strip all slippage protection.
  const minimumAmountRaw = quote.output?.minimumAmount ?? quote.output?.amount
  if (minimumAmountRaw === undefined) {
    throw new Error('Malformed Gnosis aggregation quote: missing output minimum amount')
  }
  const amountOutMinimum = BigNumber.from(minimumAmountRaw)
  if (amountOutMinimum.isZero()) {
    throw new Error('Malformed Gnosis aggregation quote: output minimum amount is zero')
  }
  const recipient = quote.output?.recipient ?? quote.swapper ?? ZERO_ADDRESS
  const deadline = (args.deadline ?? Math.floor(Date.now() / 1000) + AGGREGATION_DEADLINE_SECONDS).toString()
  const legs = quote.aggregation.legs.map((leg) => [leg.amountIn, leg.steps.map((step) => [step.stepType, step.data])])

  return {
    to: GNOSIS_AGGREGATION_ROUTER_ADDRESS,
    data: aggregationRouterInterface.encodeFunctionData('execute', [
      quote.aggregation.tokenIn,
      amountIn,
      quote.aggregation.tokenOut,
      amountOutMinimum,
      recipient,
      deadline,
      legs,
    ]),
    value: '0x0',
    from: quote.swapper,
    chainId: UniverseChainId.Gnosis,
  }
}
