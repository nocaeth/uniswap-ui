import { TradingApi } from '@universe/api'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  GNOSIS_SDAI,
  GNOSIS_SDAI_ADAPTER_ADDRESS,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { areAddressesEqual } from 'uniswap/src/utils/addresses'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const NATIVE_ADDRESS_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const GNOSIS_SDAI_ADAPTER_QUOTE_ID = 'gnosis-sdai-adapter'

export enum GnosisSdaiAdapterDirection {
  AssetToSdai = 'asset-to-sdai',
  SdaiToAsset = 'sdai-to-asset',
}

function isGnosisAddressEqual(a: string | undefined, b: string): boolean {
  if (!a) {
    return false
  }

  return areAddressesEqual({
    addressInput1: { address: a, chainId: UniverseChainId.Gnosis },
    addressInput2: { address: b, chainId: UniverseChainId.Gnosis },
  })
}

export function isGnosisNativeAddress(address: string | undefined): boolean {
  return isGnosisAddressEqual(address, ZERO_ADDRESS) || isGnosisAddressEqual(address, NATIVE_ADDRESS_SENTINEL)
}

export function isGnosisSdaiAdapterAssetToken(address: string | undefined): boolean {
  return isGnosisNativeAddress(address) || isGnosisAddressEqual(address, GNOSIS_WXDAI)
}

export function isGnosisSdaiAdapterSdaiToken(address: string | undefined): boolean {
  return isGnosisAddressEqual(address, GNOSIS_SDAI)
}

export function getGnosisSdaiAdapterDirection(args: {
  tokenIn: string | undefined
  tokenOut: string | undefined
}): GnosisSdaiAdapterDirection | undefined {
  if (isGnosisSdaiAdapterAssetToken(args.tokenIn) && isGnosisSdaiAdapterSdaiToken(args.tokenOut)) {
    return GnosisSdaiAdapterDirection.AssetToSdai
  }

  if (isGnosisSdaiAdapterSdaiToken(args.tokenIn) && isGnosisSdaiAdapterAssetToken(args.tokenOut)) {
    return GnosisSdaiAdapterDirection.SdaiToAsset
  }

  return undefined
}

export function getGnosisSdaiAdapterApprovalSpender(args: {
  tokenIn: string | undefined
  tokenOut: string | undefined
}): string | undefined {
  const direction = getGnosisSdaiAdapterDirection(args)
  if (!direction || isGnosisNativeAddress(args.tokenIn)) {
    return undefined
  }

  return GNOSIS_SDAI_ADAPTER_ADDRESS
}

export function isGnosisSdaiAdapterQuote(quote: TradingApi.ClassicQuote): boolean {
  return (
    quote.quoteId === GNOSIS_SDAI_ADAPTER_QUOTE_ID &&
    Boolean(getGnosisSdaiAdapterDirection({ tokenIn: quote.input?.token, tokenOut: quote.output?.token }))
  )
}
