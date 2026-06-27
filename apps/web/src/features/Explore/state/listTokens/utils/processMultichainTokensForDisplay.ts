import type { MultichainToken } from '@uniswap/client-data-api/dist/data/v1/types_pb'
import { isLegacyGnosisDiscoveryTokenAddress } from 'uniswap/src/features/tokens/gnosisCanonicalTokens'
import { TokenSortMethod } from '~/components/Tokens/constants'
import type { UseListTokensOptions } from '~/features/Explore/state/listTokens/types'
import { buildTokenSortRankFromMultichain } from '~/features/Explore/state/listTokens/utils/buildTokenSortRankFromMultichain'
import { filterMultichainTokensBySearchString } from '~/features/Explore/state/listTokens/utils/filterMultichainTokensBySearchString'

function sortMultichainTokensByPrice(tokens: MultichainToken[], sortAscending: boolean): MultichainToken[] {
  const sorted = [...tokens].sort((a, b) => {
    const priceA = a.stats?.price ?? 0
    const priceB = b.stats?.price ?? 0
    return priceB - priceA
  })
  return sortAscending ? sorted.reverse() : sorted
}

/** Client-side sort only (PRICE); otherwise API / legacy order is kept. */
function sortTokensForDisplay(tokens: MultichainToken[], options: Required<UseListTokensOptions>): MultichainToken[] {
  if (options.sortMethod === TokenSortMethod.PRICE) {
    return sortMultichainTokensByPrice(tokens, options.sortAscending)
  }
  return tokens
}

function removeLegacyGnosisDiscoveryTokenAddresses(token: MultichainToken): MultichainToken | undefined {
  const chainTokens = token.chainTokens.filter(
    (chainToken) =>
      !isLegacyGnosisDiscoveryTokenAddress({
        chainId: chainToken.chainId,
        address: chainToken.address,
      }),
  )

  if (!chainTokens.length) {
    return undefined
  }

  if (chainTokens.length === token.chainTokens.length) {
    return token
  }

  const filteredToken = token.clone()
  filteredToken.chainTokens = chainTokens
  return filteredToken
}

function filterLegacyGnosisDiscoveryTokens(tokens: MultichainToken[]): MultichainToken[] {
  return tokens
    .map(removeLegacyGnosisDiscoveryTokenAddresses)
    .filter((token): token is MultichainToken => token !== undefined)
}

type ProcessMultichainTokensForDisplayResult = {
  topTokens: MultichainToken[]
  /** multichainId → 1-based rank after client sort, before search filter. */
  tokenSortRank: Record<string, number>
}

/**
 * 1) Sort — client PRICE sort when `sortMethod === PRICE`, else incoming order.
 * 2) Rank — `tokenSortRank` from that sorted list.
 * 3) Filter — search on the sorted list (`filterString`).
 *
 * - Legacy path: hook does non-PRICE sort only; PRICE sort + filter are done here, then caller slices.
 * - Backend path: BE sorts except for PRICE; we apply client-side price sort here when sortMethod is PRICE.
 */
export function processMultichainTokensForDisplay(
  tokens: MultichainToken[],
  options: Required<UseListTokensOptions>,
): ProcessMultichainTokensForDisplayResult {
  const discoveryTokens = filterLegacyGnosisDiscoveryTokens(tokens)
  const sorted = sortTokensForDisplay(discoveryTokens, options)
  const tokenSortRank = buildTokenSortRankFromMultichain(sorted)
  const topTokens = filterMultichainTokensBySearchString(sorted, options.filterString)
  return { topTokens, tokenSortRank }
}
