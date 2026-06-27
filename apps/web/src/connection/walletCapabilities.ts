import { TradingApi } from '@universe/api'
import { numberToHex } from '@universe/encoding'
import { FeatureFlags, getFeatureFlag } from '@universe/gating'
import { checkWalletDelegation } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import { logger } from 'utilities/src/logger/logger'

// Local copies of the EIP-5792 types and capability-derivation logic that the
// web app previously imported from the (now-removed) `wallet` package.

/** CAIP-345 response enrichment for `wallet_sendCalls` / `wallet_getCallsStatus`. */
export interface Caip345 {
  caip2: string
  transactionHashes: string[]
}

/** A per-chain capability map value (EIP-5792 `wallet_getCapabilities`). */
export type Capability = Record<string, unknown>

export interface GetCallsStatusTransactionReceiptLog {
  address: string
  data: string
  topics: string[]
}

export interface GetCallsStatusTransactionReceipt {
  logs?: GetCallsStatusTransactionReceiptLog[]
  status: string // Hex 1 or 0 for success or failure
  blockHash?: string
  blockNumber?: string
  gasUsed?: string
  transactionHash: string
}

export interface GetCallsStatusResult {
  version: string
  id: string
  chainId: string
  status: number // Status codes as per EIP-5792
  atomic?: boolean
  receipts?: GetCallsStatusTransactionReceipt[]
  capabilities?: {
    caip345?: Caip345
    [key: string]: unknown
  }
}

/**
 * Smart wallet capability status for a chain.
 * - `supported`: wallet is already delegated to Uniswap
 * - `ready`: wallet can be delegated (fresh delegation / pending upgrade)
 * - `unsupported`: not delegation-capable (or no smart wallet consent)
 */
type SmartWalletCapabilityStatus = 'unsupported' | 'supported' | 'ready'

/** Returns true if this is a fresh delegation (no current delegation, but there is a latest delegation address) */
function isFreshDelegation(details: TradingApi.DelegationDetails): boolean {
  return !details.currentDelegationAddress && !!details.latestDelegationAddress
}

function buildSmartWalletCapabilities({
  status,
  is7677GasSponsorshipEnabled,
}: {
  status: SmartWalletCapabilityStatus
  is7677GasSponsorshipEnabled: boolean
}): Capability {
  const chainCapability: Capability = { atomic: { status } }

  if (is7677GasSponsorshipEnabled && status !== 'unsupported') {
    chainCapability['paymasterService'] = { supported: true }
  }

  return chainCapability
}

function getCapabilitiesForDelegationStatus(
  delegationStatus: TradingApi.ChainDelegationMap | undefined,
  hasSmartWalletConsent: boolean,
): Record<string, Capability> {
  if (!delegationStatus) {
    return {}
  }
  const is7677GasSponsorshipEnabled = getFeatureFlag(FeatureFlags.Support7677GasSponsorship)
  const capabilities: Record<string, Capability> = {}
  for (const [chainId, delegationStatusForChain] of Object.entries(delegationStatus)) {
    const isDelegated = delegationStatusForChain.isWalletDelegatedToUniswap
    const isFresh = isFreshDelegation(delegationStatusForChain)

    let status: SmartWalletCapabilityStatus = 'unsupported'
    if (hasSmartWalletConsent) {
      // If the user has consented to smart wallets, we can use the delegation status to determine the capabilities
      // & if the wallet is delegated to Uniswap, it's supported, even if the delegation address is outdated
      if (isDelegated) {
        status = 'supported'
      } else if (isFresh) {
        status = 'ready'
      }
    }

    capabilities[numberToHex(parseInt(chainId, 10))] = buildSmartWalletCapabilities({
      status,
      is7677GasSponsorshipEnabled,
    })
  }
  return capabilities
}

/**
 * Shared core logic for handling getCapabilities requests.
 */
export async function getCapabilitiesCore({
  address,
  chainIds,
  hasSmartWalletConsent,
}: {
  address: string
  chainIds: number[]
  hasSmartWalletConsent: boolean
}): Promise<Record<string, Capability>> {
  let delegationStatusResponse: TradingApi.WalletCheckDelegationResponseBody | undefined

  try {
    delegationStatusResponse = await checkWalletDelegation({
      walletAddresses: [address],
      chainIds,
    })
  } catch (error) {
    logger.error(error, {
      tags: { file: 'walletCapabilities.ts', function: 'getCapabilitiesCore' },
      extra: { address, chainIds, hasSmartWalletConsent },
    })
  }

  const capabilities = getCapabilitiesForDelegationStatus(
    delegationStatusResponse?.delegationDetails[address],
    hasSmartWalletConsent,
  )

  return capabilities
}
