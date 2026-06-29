type Listener = (...args: unknown[]) => void

const DISABLED_ERROR_MESSAGE = 'Solana mobile wallets are disabled in Gnosis lean builds.'

function disabledError(): Error {
  return new Error(DISABLED_ERROR_MESSAGE)
}

export type AddressSelector = {
  select(addresses: string[]): Promise<string>
}

export type AuthorizationResultCache = {
  clear(): Promise<void>
  get(): Promise<unknown | undefined>
  set(authorizationResult: unknown): Promise<void>
}

export const SolanaMobileWalletAdapterWalletName = 'Mobile Wallet Adapter'
export const SolanaMobileWalletAdapterRemoteWalletName = 'Remote Mobile Wallet Adapter'

export function createDefaultAddressSelector(): AddressSelector {
  return {
    async select(addresses: string[]): Promise<string> {
      if (!addresses[0]) {
        throw disabledError()
      }

      return addresses[0]
    },
  }
}

export function createDefaultAuthorizationResultCache(): AuthorizationResultCache {
  return {
    async clear(): Promise<void> {},
    async get(): Promise<undefined> {
      return undefined
    },
    async set(): Promise<void> {},
  }
}

export function createDefaultWalletNotFoundHandler(): () => Promise<void> {
  return async (): Promise<void> => {}
}

class UnsupportedSolanaMobileWalletAdapter {
  readonly name = SolanaMobileWalletAdapterWalletName
  readonly url = 'https://solanamobile.com/wallets'
  readonly icon = 'data:image/svg+xml;base64,'
  readonly supportedTransactionVersions = new Set()
  readonly readyState = 'Unsupported'

  private readonly listeners = new Map<string, Set<Listener>>()

  get publicKey(): null {
    return null
  }

  get connected(): false {
    return false
  }

  get connecting(): false {
    return false
  }

  on(eventName: string, listener: Listener): this {
    const eventListeners = this.listeners.get(eventName) ?? new Set()
    eventListeners.add(listener)
    this.listeners.set(eventName, eventListeners)
    return this
  }

  off(eventName: string, listener: Listener): this {
    this.listeners.get(eventName)?.delete(listener)
    return this
  }

  async autoConnect_DO_NOT_USE_OR_YOU_WILL_BE_FIRED(): Promise<void> {
    throw disabledError()
  }

  async autoConnect(): Promise<void> {
    throw disabledError()
  }

  async connect(): Promise<void> {
    throw disabledError()
  }

  async disconnect(): Promise<void> {}

  async performAuthorization(): Promise<never> {
    throw disabledError()
  }

  async signIn(): Promise<never> {
    throw disabledError()
  }

  async signMessage(): Promise<never> {
    throw disabledError()
  }

  async sendTransaction(): Promise<never> {
    throw disabledError()
  }

  async signTransaction<T>(): Promise<T> {
    throw disabledError()
  }

  async signAllTransactions<T>(): Promise<T[]> {
    throw disabledError()
  }
}

export class LocalSolanaMobileWalletAdapter extends UnsupportedSolanaMobileWalletAdapter {}

export class RemoteSolanaMobileWalletAdapter extends UnsupportedSolanaMobileWalletAdapter {}

export class SolanaMobileWalletAdapter extends LocalSolanaMobileWalletAdapter {}
