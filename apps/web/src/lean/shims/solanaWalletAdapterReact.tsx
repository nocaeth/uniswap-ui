import type { PropsWithChildren } from 'react'

const SOLANA_DISABLED_ERROR_MESSAGE = 'Solana wallets are disabled in Gnosis lean builds.'

function disabledError(): Error {
  return new Error(SOLANA_DISABLED_ERROR_MESSAGE)
}

type WalletAdapter = {
  name: string
  icon?: string
  publicKey: null
  connected: false
  connecting: false
  readyState: 'Unsupported'
  addListener(eventName: string, listener: (...args: unknown[]) => void): void
  removeListener(eventName: string, listener: (...args: unknown[]) => void): void
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export type Wallet = {
  adapter: WalletAdapter
  readyState: 'Unsupported'
}

export type WalletContextState = ReturnType<typeof useWallet>

export function WalletProvider({ children }: PropsWithChildren<{ wallets?: unknown[]; autoConnect?: boolean }>): JSX.Element {
  return <>{children}</>
}

export function ConnectionProvider({ children }: PropsWithChildren<{ endpoint?: string }>): JSX.Element {
  return <>{children}</>
}

export function useConnection(): { connection: null } {
  return { connection: null }
}

export function useWallet(): {
  autoConnect: false
  wallets: Wallet[]
  wallet: null
  publicKey: null
  connecting: false
  connected: false
  disconnecting: false
  select(walletName: string | null): void
  connect(): Promise<never>
  disconnect(): Promise<void>
  sendTransaction(): Promise<never>
  signTransaction?: undefined
  signAllTransactions?: undefined
  signMessage?: undefined
  signIn?: undefined
} {
  return {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey: null,
    connecting: false,
    connected: false,
    disconnecting: false,
    select: () => {},
    async connect(): Promise<never> {
      throw disabledError()
    },
    async disconnect(): Promise<void> {},
    async sendTransaction(): Promise<never> {
      throw disabledError()
    },
    signTransaction: undefined,
    signAllTransactions: undefined,
    signMessage: undefined,
    signIn: undefined,
  }
}
