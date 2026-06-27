import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { TransactionRequest } from '@ethersproject/providers'
import { Percent, TradeType } from '@uniswap/sdk-core'
import { RouterTradeAdapter, SwapRouter } from '@uniswap/universal-router-sdk'
import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import type {
  EVMSwapRepository,
  SwapData,
  SwapRequestParams,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/evmSwapRepository'
import { SDAI_ADAPTER_ABI } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import {
  GNOSIS_SDAI_ADAPTER_ADDRESS,
  GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  GnosisSdaiAdapterDirection,
  getGnosisSdaiAdapterDirection,
  isGnosisNativeAddress,
  isGnosisSdaiAdapterQuote,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

const DEFAULT_SLIPPAGE_PERCENT = 0.5
const DEADLINE_SECONDS = 60 * 30
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const NATIVE_ADDRESS_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const sdaiAdapterInterface = new Interface(SDAI_ADAPTER_ABI)

function isNativeSentinel(address: string | undefined): boolean {
  if (!address) {
    return false
  }

  const input = { address, chainId: UniverseChainId.Gnosis }
  return (
    areAddressesEqual({
      addressInput1: input,
      addressInput2: { address: ZERO_ADDRESS, chainId: UniverseChainId.Gnosis },
    }) ||
    areAddressesEqual({
      addressInput1: input,
      addressInput2: { address: NATIVE_ADDRESS_SENTINEL, chainId: UniverseChainId.Gnosis },
    })
  )
}

export function getGnosisRouterTradeTokenAddresses(quote: TradingApi.ClassicQuote): {
  tokenIn: string
  tokenOut: string
} {
  const topLevelTokenIn = quote.input?.token ?? ''
  const topLevelTokenOut = quote.output?.token ?? ''
  const firstRoute = quote.route?.[0]
  const firstPool = firstRoute?.[0]
  const lastPool = firstRoute?.[firstRoute.length - 1]

  return {
    tokenIn: isNativeSentinel(topLevelTokenIn) ? topLevelTokenIn : (firstPool?.tokenIn?.address ?? topLevelTokenIn),
    tokenOut: isNativeSentinel(topLevelTokenOut) ? topLevelTokenOut : (lastPool?.tokenOut?.address ?? topLevelTokenOut),
  }
}

export function buildGnosisSdaiAdapterTransaction(quote: TradingApi.ClassicQuote): TransactionRequest | undefined {
  if (!isGnosisSdaiAdapterQuote(quote)) {
    return undefined
  }

  const tokenIn = quote.input?.token
  const tokenOut = quote.output?.token
  const direction = getGnosisSdaiAdapterDirection({ tokenIn, tokenOut })
  if (!direction || !quote.input?.amount || !quote.output?.amount) {
    return undefined
  }

  const exactOutput = quote.tradeType === TradingApi.TradeType.EXACT_OUTPUT
  const amountIn = BigNumber.from(quote.input.amount)
  const amountOut = BigNumber.from(quote.output.amount)
  const recipient = quote.output.recipient ?? quote.swapper ?? ZERO_ADDRESS
  const nativeInput = isGnosisNativeAddress(tokenIn)
  const nativeOutput = isGnosisNativeAddress(tokenOut)
  if (direction === GnosisSdaiAdapterDirection.AssetToSdai && exactOutput && nativeInput) {
    throw new Error('Exact-output native xDAI -> sDAI adapter swaps are not supported')
  }

  let data: string
  if (direction === GnosisSdaiAdapterDirection.AssetToSdai) {
    if (nativeInput) {
      data = sdaiAdapterInterface.encodeFunctionData('depositXDAI', [recipient])
    } else {
      data = exactOutput
        ? sdaiAdapterInterface.encodeFunctionData('mint', [amountOut, recipient])
        : sdaiAdapterInterface.encodeFunctionData('deposit', [amountIn, recipient])
    }
  } else if (nativeOutput) {
    data = exactOutput
      ? sdaiAdapterInterface.encodeFunctionData('withdrawXDAI', [amountOut, recipient])
      : sdaiAdapterInterface.encodeFunctionData('redeemXDAI', [amountIn, recipient])
  } else {
    data = exactOutput
      ? sdaiAdapterInterface.encodeFunctionData('withdraw', [amountOut, recipient])
      : sdaiAdapterInterface.encodeFunctionData('redeem', [amountIn, recipient])
  }

  return {
    to: GNOSIS_SDAI_ADAPTER_ADDRESS,
    data,
    value: nativeInput ? amountIn : '0x0',
    from: quote.swapper,
    chainId: UniverseChainId.Gnosis,
  }
}

/**
 * Builds the UniversalRouter swap transaction client-side for Gnosis, replacing the
 * Trading API `/swap` endpoint. Consumes the CLASSIC quote produced by
 * fetchGnosisQuote and encodes calldata via @uniswap/universal-router-sdk.
 */
export function createGnosisEVMSwapRepository(): EVMSwapRepository {
  return {
    fetchSwapData: async (params: SwapRequestParams): Promise<SwapData> => {
      const quote = params.quote as TradingApi.ClassicQuote
      const sdaiAdapterTransaction = buildGnosisSdaiAdapterTransaction(quote)
      if (sdaiAdapterTransaction) {
        return {
          requestId: 'gnosis-local',
          transactions: [sdaiAdapterTransaction],
          gasFee: quote.gasFee ?? '0',
        }
      }

      if (GNOSIS_UNIVERSAL_ROUTER_ADDRESS === '0x0000000000000000000000000000000000000000') {
        throw new Error(
          'GNOSIS_UNIVERSAL_ROUTER_ADDRESS is not set. Deploy UniversalRouter and set REACT_APP_GNOSIS_UNIVERSAL_ROUTER_ADDRESS (see gnosis/contracts/README.md).',
        )
      }

      const tradeType =
        quote.tradeType === TradingApi.TradeType.EXACT_OUTPUT ? TradeType.EXACT_OUTPUT : TradeType.EXACT_INPUT
      const { tokenIn, tokenOut } = getGnosisRouterTradeTokenAddresses(quote)

      const routerTrade = RouterTradeAdapter.fromClassicQuote({
        tokenIn,
        tokenOut,
        tradeType,
        // V3PoolInRoute shapes are structurally compatible across the api/sdk packages.
        route: quote.route as unknown as Parameters<typeof RouterTradeAdapter.fromClassicQuote>[0]['route'],
      })

      const slippagePercent = quote.slippage ?? DEFAULT_SLIPPAGE_PERCENT
      const deadline = (params.deadline ?? Math.floor(Date.now() / 1000) + DEADLINE_SECONDS).toString()

      const { calldata, value } = SwapRouter.swapCallParameters(routerTrade, {
        slippageTolerance: new Percent(Math.round(slippagePercent * 100), 10_000),
        recipient: quote.swapper ?? '',
        deadlineOrPreviousBlockhash: deadline,
      })

      const transaction: TransactionRequest = {
        to: GNOSIS_UNIVERSAL_ROUTER_ADDRESS,
        data: calldata,
        value,
        from: quote.swapper,
        chainId: UniverseChainId.Gnosis,
      }

      return {
        requestId: 'gnosis-local',
        transactions: [transaction],
        gasFee: quote.gasFee ?? '0',
      }
    },
  }
}
