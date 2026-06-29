import '~/tracing'
// We intentionally import this to ensure that the WalletConnect provider is bundled as an entrypoint chunk,
// because it will always be requested anyway and we don't want to have a waterfall request pattern.
import * as WalletConnect from '@walletconnect/ethereum-provider'
import { setupTurnstileCSPErrorFilter } from '~/utils/setupTurnstileCSPErrorFilter'

export function setupFullRuntimeSideEffects(): void {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- `import *` namespace is always truthy
  if (WalletConnect) {
    console.debug('WalletConnect is defined')
  }
  setupTurnstileCSPErrorFilter()
}
