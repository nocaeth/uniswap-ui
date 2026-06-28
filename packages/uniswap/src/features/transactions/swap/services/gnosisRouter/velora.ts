/* oxlint-disable max-lines -- cohesive Velora Market API client: quote cache, rate-limit state, response parsing, and tx building */
import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import type { TransactionRequest } from '@ethersproject/providers'
import type { DiscriminatedQuoteResponse } from '@universe/api'
import { TradingApi } from '@universe/api'
import { BIPS_BASE } from 'uniswap/src/constants/misc'
import { normalizeTokenAddressForCache } from 'uniswap/src/data/cache'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { ERC20_METADATA_ABI } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_EURE_V1,
  GNOSIS_EURE_V2,
  GNOSIS_GBPE_V1,
  GNOSIS_GBPE_V2,
  GNOSIS_SDAI,
  GNOSIS_USDCE,
  GNOSIS_USDT,
  GNOSIS_VELORA_BASE_URL,
  GNOSIS_VELORA_DISABLED,
  GNOSIS_VELORA_PARTNER,
  GNOSIS_WETH,
  GNOSIS_WSTETH,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'
import { isGnosisNativeAddress } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

const GNOSIS_CHAIN_ID = UniverseChainId.Gnosis as unknown as TradingApi.ChainId

export const GNOSIS_VELORA_QUOTE_ID = 'gnosis-velora'
export const GNOSIS_VELORA_AUGUSTUS_ADDRESS = '0x6a000f20005980200259b80c5102003040001068'

const VELO_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const VELO_VERSION = '6.2'
const VELO_SIDE_SELL = 'SELL'
const DEFAULT_SLIPPAGE_PERCENT = 0.5
const VELO_QUOTE_CACHE_TTL_MS = 10_000
const VELO_PRICE_ROUTE_STALE_MS = 25_000
const VELO_REQUEST_TIMEOUT_MS = 3_500
const VELO_RATE_LIMIT_COOLDOWN_MS = 60_000
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const erc20MetaInterface = new Interface(ERC20_METADATA_ABI)
const decimalsCache = new Map<string, number>()
const quoteCache = new Map<string, { expiresAtMs: number; promise: Promise<DiscriminatedQuoteResponse | undefined> }>()
let rateLimitedUntilMs = 0

const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  [GNOSIS_WXDAI.toLowerCase()]: 18,
  [GNOSIS_USDCE.toLowerCase()]: 6,
  [GNOSIS_USDT.toLowerCase()]: 6,
  [GNOSIS_WETH.toLowerCase()]: 18,
  [GNOSIS_WSTETH.toLowerCase()]: 18,
  [GNOSIS_SDAI.toLowerCase()]: 18,
  [GNOSIS_EURE_V2.toLowerCase()]: 18,
  [GNOSIS_EURE_V1.toLowerCase()]: 18,
  [GNOSIS_GBPE_V2.toLowerCase()]: 18,
  [GNOSIS_GBPE_V1.toLowerCase()]: 18,
}

export interface VeloraSwapExchange {
  exchange: string
  srcAmount?: string
  destAmount?: string
  percent?: number
}

export interface VeloraSwap {
  srcToken: string
  destToken: string
  swapExchanges: VeloraSwapExchange[]
}

export interface VeloraRouteLeg {
  percent: number
  swaps: VeloraSwap[]
}

export type VeloraPriceRoute = Record<string, unknown> & {
  blockNumber?: number
  network?: number
  srcToken?: string
  srcDecimals?: number
  srcAmount: string
  destToken?: string
  destDecimals?: number
  destAmount: string
  bestRoute?: unknown
  gasCost?: string
  gasCostUSD?: string
  side?: string
  version?: string
  contractAddress?: string
  tokenTransferProxy?: string
  contractMethod?: string
  srcUSD?: string
  destUSD?: string
  maxImpactReached?: boolean
  hmac?: string
}

export interface VeloraQuoteRequest {
  srcToken: string
  destToken: string
  srcDecimals: number
  destDecimals: number
  amount: string
  userAddress: string
  receiver?: string
}

export interface GnosisVeloraQuoteMetadata {
  priceRoute: VeloraPriceRoute
  request: VeloraQuoteRequest
  createdAtMs: number
  slippageBps: number
  spender: string
  fallbackQuote?: TradingApi.ClassicQuote
}

export type GnosisVeloraClassicQuote = TradingApi.ClassicQuote & {
  velora: GnosisVeloraQuoteMetadata
}

function getVeloraBaseUrl(): string {
  return GNOSIS_VELORA_BASE_URL.replace(/\/$/, '')
}

function getVeloraPartner(): string {
  return GNOSIS_VELORA_PARTNER
}

function isVeloraDisabled(): boolean {
  return GNOSIS_VELORA_DISABLED
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return isString(value) ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return isNumber(value) ? value : undefined
}

function isVeloraSwapExchange(value: unknown): value is VeloraSwapExchange {
  return isRecord(value) && isString(value['exchange'])
}

function parseVeloraSwap(value: unknown): VeloraSwap | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const srcToken = readString(value, 'srcToken')
  const destToken = readString(value, 'destToken')
  const swapExchanges = value['swapExchanges']
  if (!srcToken || !destToken || !Array.isArray(swapExchanges)) {
    return undefined
  }
  return {
    srcToken,
    destToken,
    swapExchanges: swapExchanges.filter(isVeloraSwapExchange),
  }
}

function parseVeloraRouteLeg(value: unknown): VeloraRouteLeg | undefined {
  if (!isRecord(value) || !Array.isArray(value['swaps'])) {
    return undefined
  }

  return {
    percent: readNumber(value, 'percent') ?? 100,
    swaps: value['swaps'].map(parseVeloraSwap).filter((swap): swap is VeloraSwap => swap !== undefined),
  }
}

function parseVeloraPriceRoute(value: unknown): VeloraPriceRoute | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const srcAmount = readString(value, 'srcAmount')
  const destAmount = readString(value, 'destAmount')
  if (!srcAmount || !destAmount || BigNumber.from(destAmount).isZero()) {
    return undefined
  }

  return {
    ...value,
    srcAmount,
    destAmount,
  }
}

export function getVeloraRouteLegs(priceRoute: VeloraPriceRoute): VeloraRouteLeg[] {
  const bestRoute = priceRoute['bestRoute']
  if (!Array.isArray(bestRoute)) {
    return []
  }

  return bestRoute.map(parseVeloraRouteLeg).filter((leg): leg is VeloraRouteLeg => leg !== undefined)
}

function parsePricesResponse(value: unknown): VeloraPriceRoute | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  return parseVeloraPriceRoute(value['priceRoute'])
}

function parseTransactionResponse(value: unknown): TransactionRequest | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const to = readString(value, 'to')
  const data = readString(value, 'data')
  if (!to || !data) {
    return undefined
  }

  const tx: TransactionRequest = {
    to,
    data,
    from: readString(value, 'from'),
    value: readString(value, 'value') ?? '0',
    chainId: readNumber(value, 'chainId') ?? UniverseChainId.Gnosis,
  }

  const gasPrice = readString(value, 'gasPrice')
  const maxFeePerGas = readString(value, 'maxFeePerGas')
  const maxPriorityFeePerGas = readString(value, 'maxPriorityFeePerGas')
  const gas = readString(value, 'gas')
  if (gasPrice) {
    tx.gasPrice = gasPrice
  }
  if (maxFeePerGas) {
    tx.maxFeePerGas = maxFeePerGas
  }
  if (maxPriorityFeePerGas) {
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas
  }
  if (gas) {
    tx.gasLimit = gas
  }

  return tx
}

function isSameAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false
  }
  return areAddressesEqual({
    addressInput1: { address: a, chainId: UniverseChainId.Gnosis },
    addressInput2: { address: b, chainId: UniverseChainId.Gnosis },
  })
}

function toVeloraToken(address: string): string {
  return isGnosisNativeAddress(address) ? VELO_NATIVE_TOKEN : address
}

function isValidVeloraQuoteResponse(
  response: unknown,
): response is DiscriminatedQuoteResponse & { routing: TradingApi.Routing.CLASSIC; quote: GnosisVeloraClassicQuote } {
  if (!isRecord(response) || response['routing'] !== TradingApi.Routing.CLASSIC) {
    return false
  }

  const quote = response['quote']
  return isRecord(quote) && isGnosisVeloraQuote(quote as TradingApi.ClassicQuote)
}

function getVeloraSpender(priceRoute: VeloraPriceRoute): string {
  return (
    readString(priceRoute, 'tokenTransferProxy') ??
    readString(priceRoute, 'contractAddress') ??
    GNOSIS_VELORA_AUGUSTUS_ADDRESS
  )
}

function toSlippageBps(slippagePercent: number | undefined): number {
  const normalized = slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT
  return Math.max(0, Math.min(BIPS_BASE, Math.round(normalized * 100)))
}

function applyExactInputSlippage(amount: string, slippageBps: number): string {
  return BigNumber.from(amount)
    .mul(BIPS_BASE - slippageBps)
    .div(BIPS_BASE)
    .toString()
}

function estimatePriceImpact(priceRoute: VeloraPriceRoute): number {
  const srcUsd = Number(readString(priceRoute, 'srcUSD'))
  const destUsd = Number(readString(priceRoute, 'destUSD'))
  if (!Number.isFinite(srcUsd) || !Number.isFinite(destUsd) || srcUsd <= 0) {
    return 0
  }

  return Number(Math.max(0, ((srcUsd - destUsd) / srcUsd) * 100).toFixed(3))
}

function buildRouteString(priceRoute: VeloraPriceRoute): string {
  return getVeloraRouteLegs(priceRoute)
    .map((leg) =>
      leg.swaps
        .map((swap) =>
          swap.swapExchanges
            .map((exchange) => exchange.exchange)
            .filter(Boolean)
            .join('+'),
        )
        .filter(Boolean)
        .join(' -> '),
    )
    .filter(Boolean)
    .join(' + ')
}

function getCacheKey(params: TradingApi.QuoteRequest): string {
  return [
    params.type,
    params.tokenInChainId,
    params.tokenOutChainId,
    normalizeTokenAddressForCache(params.tokenIn),
    normalizeTokenAddressForCache(params.tokenOut),
    params.amount,
    normalizeTokenAddressForCache(params.swapper),
    params.recipient ? normalizeTokenAddressForCache(params.recipient) : '',
    params.slippageTolerance ?? '',
  ].join(':')
}

function getRetryAfterMs(retryAfter: string | null): number | undefined {
  if (!retryAfter) {
    return undefined
  }

  const retryAfterSeconds = Number(retryAfter)
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(1_000, retryAfterSeconds * 1_000)
  }

  const retryAtMs = Date.parse(retryAfter)
  if (Number.isFinite(retryAtMs)) {
    return Math.max(1_000, retryAtMs - Date.now())
  }

  return undefined
}

function markVeloraRateLimited(response: Response): void {
  rateLimitedUntilMs =
    Date.now() + (getRetryAfterMs(response.headers.get('Retry-After')) ?? VELO_RATE_LIMIT_COOLDOWN_MS)
}

function shouldSkipVelora(): boolean {
  return isVeloraDisabled() || Date.now() < rateLimitedUntilMs
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VELO_REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return undefined
  }
}

async function readTokenDecimals(address: string): Promise<number> {
  if (isGnosisNativeAddress(address)) {
    return 18
  }

  const cacheKey = normalizeTokenAddressForCache(address)
  const cached = decimalsCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const known = KNOWN_TOKEN_DECIMALS[cacheKey]
  if (known !== undefined) {
    decimalsCache.set(cacheKey, known)
    return known
  }

  const result = await getGnosisProvider().call({
    to: address,
    data: erc20MetaInterface.encodeFunctionData('decimals'),
  })
  const decimals = Number(erc20MetaInterface.decodeFunctionResult('decimals', result)[0])
  decimalsCache.set(cacheKey, decimals)
  return decimals
}

async function fetchVeloraPriceRoute(request: VeloraQuoteRequest): Promise<VeloraPriceRoute | undefined> {
  if (shouldSkipVelora()) {
    return undefined
  }

  const url = new URL(`${getVeloraBaseUrl()}/prices`)
  url.searchParams.set('srcToken', request.srcToken)
  url.searchParams.set('destToken', request.destToken)
  url.searchParams.set('amount', request.amount)
  url.searchParams.set('srcDecimals', String(request.srcDecimals))
  url.searchParams.set('destDecimals', String(request.destDecimals))
  url.searchParams.set('side', VELO_SIDE_SELL)
  url.searchParams.set('network', String(UniverseChainId.Gnosis))
  url.searchParams.set('version', VELO_VERSION)
  url.searchParams.set('partner', getVeloraPartner())

  const response = await fetchWithTimeout(url.toString())
  if (response.status === 429) {
    markVeloraRateLimited(response)
    return undefined
  }
  if (!response.ok) {
    return undefined
  }

  const priceRoute = parsePricesResponse(await readJson(response))
  if (!priceRoute || priceRoute['maxImpactReached'] === true || readString(priceRoute, 'version') !== VELO_VERSION) {
    return undefined
  }

  return priceRoute
}

async function buildVeloraQuoteRequest(params: TradingApi.QuoteRequest): Promise<VeloraQuoteRequest> {
  const [srcDecimals, destDecimals] = await Promise.all([
    readTokenDecimals(params.tokenIn),
    readTokenDecimals(params.tokenOut),
  ])

  return {
    srcToken: toVeloraToken(params.tokenIn),
    destToken: toVeloraToken(params.tokenOut),
    srcDecimals,
    destDecimals,
    amount: params.amount,
    userAddress: params.swapper,
    receiver: params.recipient,
  }
}

async function fetchGnosisVeloraQuoteUncached(
  params: TradingApi.QuoteRequest,
): Promise<DiscriminatedQuoteResponse | undefined> {
  if (
    params.type !== TradingApi.TradeType.EXACT_INPUT ||
    Number(params.tokenInChainId) !== UniverseChainId.Gnosis ||
    Number(params.tokenOutChainId) !== UniverseChainId.Gnosis ||
    params.swapper === ZERO_ADDRESS ||
    shouldSkipVelora()
  ) {
    return undefined
  }

  const request = await buildVeloraQuoteRequest(params)
  const priceRoute = await fetchVeloraPriceRoute(request)
  if (!priceRoute) {
    return undefined
  }

  const slippageBps = toSlippageBps(params.slippageTolerance)
  const gasUseEstimate = readString(priceRoute, 'gasCost') ?? '0'
  const [blockNumber, gasPrice] = await Promise.all([
    readNumber(priceRoute, 'blockNumber')
      ? Promise.resolve(readNumber(priceRoute, 'blockNumber') as number)
      : getGnosisProvider().getBlockNumber(),
    getGnosisProvider().getGasPrice(),
  ])
  const gasFee = BigNumber.from(gasUseEstimate).mul(gasPrice).toString()
  const recipient = params.recipient ?? params.swapper
  const quote: GnosisVeloraClassicQuote = {
    chainId: GNOSIS_CHAIN_ID,
    swapper: params.swapper,
    input: { token: params.tokenIn, amount: priceRoute.srcAmount },
    output: {
      token: params.tokenOut,
      amount: priceRoute.destAmount,
      minimumAmount: applyExactInputSlippage(priceRoute.destAmount, slippageBps),
      recipient,
    },
    tradeType: TradingApi.TradeType.EXACT_INPUT,
    slippage: params.slippageTolerance ?? DEFAULT_SLIPPAGE_PERCENT,
    route: [],
    routeString: buildRouteString(priceRoute),
    quoteId: GNOSIS_VELORA_QUOTE_ID,
    gasUseEstimate,
    gasFee,
    blockNumber: String(blockNumber),
    priceImpact: estimatePriceImpact(priceRoute),
    portionBips: 0,
    velora: {
      priceRoute,
      request,
      createdAtMs: Date.now(),
      slippageBps,
      spender: getVeloraSpender(priceRoute),
    },
  }

  return {
    requestId: GNOSIS_VELORA_QUOTE_ID,
    routing: TradingApi.Routing.CLASSIC,
    permitData: null,
    quote,
  } as DiscriminatedQuoteResponse
}

export async function fetchGnosisVeloraQuote(
  params: TradingApi.QuoteRequest,
): Promise<DiscriminatedQuoteResponse | undefined> {
  if (shouldSkipVelora()) {
    return undefined
  }

  const now = Date.now()
  const cacheKey = getCacheKey(params)
  const cached = quoteCache.get(cacheKey)
  if (cached && cached.expiresAtMs > now) {
    return cached.promise
  }

  const promise = fetchGnosisVeloraQuoteUncached(params).catch(() => {
    quoteCache.delete(cacheKey)
    return undefined
  })
  quoteCache.set(cacheKey, { expiresAtMs: now + VELO_QUOTE_CACHE_TTL_MS, promise })
  return promise
}

export function getGnosisVeloraQuoteMetadata(quote: TradingApi.ClassicQuote): GnosisVeloraQuoteMetadata | undefined {
  const metadata = (quote as { velora?: unknown }).velora
  if (!isRecord(metadata)) {
    return undefined
  }

  const priceRoute = parseVeloraPriceRoute(metadata['priceRoute'])
  const request = metadata['request']
  const createdAtMs = readNumber(metadata, 'createdAtMs')
  const slippageBps = readNumber(metadata, 'slippageBps')
  const spender = readString(metadata, 'spender')
  if (!priceRoute || !isRecord(request) || createdAtMs === undefined || slippageBps === undefined || !spender) {
    return undefined
  }

  const srcToken = readString(request, 'srcToken')
  const destToken = readString(request, 'destToken')
  const amount = readString(request, 'amount')
  const userAddress = readString(request, 'userAddress')
  const srcDecimals = readNumber(request, 'srcDecimals')
  const destDecimals = readNumber(request, 'destDecimals')
  if (!srcToken || !destToken || !amount || !userAddress || srcDecimals === undefined || destDecimals === undefined) {
    return undefined
  }

  const fallbackQuote = isRecord(metadata['fallbackQuote'])
    ? (metadata['fallbackQuote'] as TradingApi.ClassicQuote)
    : undefined

  return {
    priceRoute,
    request: {
      srcToken,
      destToken,
      amount,
      userAddress,
      srcDecimals,
      destDecimals,
      receiver: readString(request, 'receiver'),
    },
    createdAtMs,
    slippageBps,
    spender,
    ...(fallbackQuote ? { fallbackQuote } : {}),
  }
}

export function isGnosisVeloraQuote(quote: TradingApi.ClassicQuote): quote is GnosisVeloraClassicQuote {
  return quote.quoteId === GNOSIS_VELORA_QUOTE_ID && getGnosisVeloraQuoteMetadata(quote) !== undefined
}

export function getGnosisVeloraApprovalSpender(quote: unknown): string | undefined {
  if (!isValidVeloraQuoteResponse(quote) || isGnosisNativeAddress(quote.quote.input?.token)) {
    return undefined
  }
  return getGnosisVeloraQuoteMetadata(quote.quote)?.spender
}

export function getGnosisVeloraFallbackQuote(quote: TradingApi.ClassicQuote): TradingApi.ClassicQuote | undefined {
  return getGnosisVeloraQuoteMetadata(quote)?.fallbackQuote
}

export function withGnosisVeloraFallbackQuote(
  response: DiscriminatedQuoteResponse,
  fallbackQuote: TradingApi.ClassicQuote,
): DiscriminatedQuoteResponse {
  if (!isValidVeloraQuoteResponse(response)) {
    return response
  }

  const quoteWithFallback: GnosisVeloraClassicQuote = {
    ...response.quote,
    velora: {
      ...response.quote.velora,
      fallbackQuote,
    },
  }

  return {
    ...response,
    quote: quoteWithFallback,
  }
}

async function getFreshVeloraMetadata(metadata: GnosisVeloraQuoteMetadata): Promise<GnosisVeloraQuoteMetadata> {
  if (Date.now() - metadata.createdAtMs < VELO_PRICE_ROUTE_STALE_MS) {
    return metadata
  }

  const priceRoute = await fetchVeloraPriceRoute(metadata.request)
  if (!priceRoute) {
    throw new Error('Unable to refresh stale Velora price route')
  }

  return {
    ...metadata,
    priceRoute,
    createdAtMs: Date.now(),
    spender: getVeloraSpender(priceRoute),
  }
}

export async function buildGnosisVeloraTransaction(args: {
  quote: TradingApi.ClassicQuote
  deadline?: number
}): Promise<TransactionRequest | undefined> {
  if (!isGnosisVeloraQuote(args.quote)) {
    return undefined
  }

  const metadata = await getFreshVeloraMetadata(args.quote.velora)
  const body: Record<string, unknown> = {
    priceRoute: metadata.priceRoute,
    srcToken: metadata.request.srcToken,
    srcDecimals: metadata.request.srcDecimals,
    destToken: metadata.request.destToken,
    destDecimals: metadata.request.destDecimals,
    srcAmount: metadata.priceRoute.srcAmount,
    slippage: metadata.slippageBps,
    userAddress: metadata.request.userAddress,
    partner: getVeloraPartner(),
  }

  const receiver = args.quote.output?.recipient ?? metadata.request.receiver
  if (receiver && !isSameAddress(receiver, metadata.request.userAddress)) {
    body['receiver'] = receiver
  }
  if (args.deadline) {
    body['deadline'] = args.deadline
  }

  const url = new URL(`${getVeloraBaseUrl()}/transactions/${UniverseChainId.Gnosis}`)
  url.searchParams.set('ignoreChecks', 'true')
  url.searchParams.set('ignoreGasEstimate', 'true')

  const response = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 429) {
    markVeloraRateLimited(response)
    throw new Error('Velora transaction build rate-limited')
  }
  if (!response.ok) {
    throw new Error('Velora transaction build failed')
  }

  const transaction = parseTransactionResponse(await readJson(response))
  if (!transaction) {
    throw new Error('Velora transaction build returned invalid tx params')
  }

  return {
    ...transaction,
    from: transaction.from ?? metadata.request.userAddress,
    chainId: UniverseChainId.Gnosis,
  }
}

export function __resetGnosisVeloraForTests(): void {
  quoteCache.clear()
  decimalsCache.clear()
  rateLimitedUntilMs = 0
}
