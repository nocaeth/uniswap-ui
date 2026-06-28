# Deep Link Support

This guide explains how to create URLs that link directly to supported pages on the NOCA web application (`swap.gno.now`).

## Trading Interfaces

### Swap

Opens the swap interface with pre-filled token pairs, amounts, and chain selection.

**Format:**

```url
https://swap.gno.now/swap?inputCurrency={address}&outputCurrency={address}&chain=gnosis&value={amount}&field={INPUT|OUTPUT}
```

**Parameters:**

- `inputCurrency` - Input token address or `NATIVE`
- `outputCurrency` - Output token address or `NATIVE`
- `chain` - Network name for input token. Use `gnosis` for this deployment.
- `value` - (Optional) Amount to swap
- `field` - (Optional) Whether the amount refers to `INPUT` or `OUTPUT` token

**Examples:**

```url
https://swap.gno.now/swap?inputCurrency=NATIVE&outputCurrency=0xaf204776c7245bF4147c2612BF6e5972Ee483701&chain=gnosis
https://swap.gno.now/swap?inputCurrency=0xaf204776c7245bF4147c2612BF6e5972Ee483701&outputCurrency=NATIVE&chain=gnosis&value=100&field=INPUT
```

Buy, sell, limit, and send web routes are intentionally not mounted in this Gnosis-only deployment.

## Explore & Browse

### Explore Page

Browse tokens, pools, and trending assets.

**Format:**

```url
https://swap.gno.now/explore
```

**With specific tab:**

```url
https://swap.gno.now/explore/tokens
https://swap.gno.now/explore/pools
https://swap.gno.now/explore/transactions
```

### Token Pages

#### View a Specific Token

Opens a token's detail page with charts, price information, and trading options.

**Format:**

```url
https://swap.gno.now/explore/tokens/{chainName}/{tokenAddress}
```

**Parameters:**

- `chainName` - Network name: `gnosis`
- `tokenAddress` - Token contract address, or `NATIVE` for xDAI

**Examples:**

```url
https://swap.gno.now/explore/tokens/gnosis/NATIVE
https://swap.gno.now/explore/tokens/gnosis/0xaf204776c7245bF4147c2612BF6e5972Ee483701
```

**Legacy Format (also supported):**

```url
https://swap.gno.now/tokens/{chainName}/{tokenAddress}
```

#### Browse Tokens by Network

Opens the token explorer page filtered to a specific network.

**Format:**

```url
https://swap.gno.now/explore/tokens/{chainName}
```

**Note:** If no chain name is provided, the page defaults to the supported Gnosis view.

**Examples:**

```url
https://swap.gno.now/explore/tokens/gnosis
https://swap.gno.now/explore/tokens
```

### Pool Pages (Web Only)

#### View a Specific Pool

Opens a liquidity pool's detail page with trading information and liquidity data.

**Format:**

```url
https://swap.gno.now/explore/pools/{chainName}/{poolAddress}
```

**Parameters:**

- `chainName` - Network name: `gnosis`
- `poolAddress` - Pool contract address

**Example:**

```url
https://swap.gno.now/explore/pools/gnosis/0x34D1b42B64eD98F1327aF9cA0BB2A87dFB94d305
```

## Tips for Creating Deep Links

### Supported Network

- `gnosis` (Gnosis Chain)

### Native Currency Formats

You can specify xDAI in several ways:

- `NATIVE`
- Actual native token address

### Case Sensitivity

- Network names are **case-insensitive** (`Gnosis` = `gnosis`)
- Token addresses are **case-insensitive**
- Parameter names are **case-sensitive** (`inputCurrency` ≠ `InputCurrency`)

### Bookmarking & Sharing

- All URLs can be bookmarked for quick access
- URLs preserve their state during wallet connection
- Share links with pre-filled trading parameters for easier onboarding

### Testing Your Links

1. Copy any URL from the examples above
2. Paste it into your browser
3. Verify the interface opens with correct pre-filled values
4. Test on both desktop and mobile browsers

---

## Technical Implementation Details

This section provides technical details for developers integrating these URLs into their applications.

### URL Processing Architecture

**Routing System:**

- Route definitions: `apps/web/src/pages/RouteDefinitions.tsx`
- All supported paths: `apps/web/src/pages/paths.ts`
- React Router with `matchPath()` for parameter extraction

**Query Parameter Processing:**

1. **Swap / trade URL query helpers** (`pages/Swap/Swap/state/tradeQueryParams.ts`):
   - `queryParametersToCurrencyState()` - Parses currency addresses, chain IDs, amounts, and field
   - `parseCurrencyFromURLParameter()` - Validates and normalizes currency addresses
   - `serializeSwapStateToURLParameters()` / `serializeSwapAddressesToURLParameters()` - Build swap query strings
   - `getParsedChainId()` - Extracts and validates chain ID from query string (`utils/params/chainParams.ts`)
   - `useInitialCurrencyState()` - Hook in `pages/Swap/Swap/state/hooks.tsx` that uses the parsers above

**Tab-based Navigation:**

The Gnosis web app currently supports `/swap` only:

- `PATHNAME_TO_TAB` maps unsupported paths back to the swap tab.
- Buy, sell, limit, and send web routes are intentionally not mounted.

**Error Handling:**

- Invalid or unsupported chain names are normalized to the Gnosis-only app state where possible
- Invalid token addresses show "not found" error
- Missing required parameters fall back to empty states
- Users can still interact with interface even with invalid URL parameters

**Chain ID Validation:**

- `useSupportedChainId()` validates chain IDs
- `useEnabledChains()` checks testnet/mainnet mode compatibility
- `getChainInfo()` retrieves chain metadata
- Unsupported chains prompt chain switching UI

**Currency Loading:**

- `useCurrency()` hook loads currency objects from addresses
- Supports ERC20 tokens and native currencies
- Caches currency data for performance
- Falls back gracefully for invalid addresses
