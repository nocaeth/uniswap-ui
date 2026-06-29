export class CoinbaseWalletAdapter {
  readonly name = 'Coinbase Wallet'
  readonly readyState = 'Unsupported'
  readonly connected = false
  readonly connecting = false
  readonly publicKey = null

  async connect(): Promise<void> {
    throw new Error('Solana Coinbase wallet is disabled in Gnosis lean builds.')
  }

  async disconnect(): Promise<void> {}
}
