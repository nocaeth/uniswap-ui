import '~/global.css'
import '~/polyfills'
// note the reason for the setupi18n function is to avoid webpack tree shaking the file out
import { setupi18n } from 'uniswap/src/i18n/i18n-setup-interface'
import { setupWagmiAutoConnect } from '~/components/Web3Provider/wagmiAutoConnect'
import { setupFullRuntimeSideEffects } from '~/sideEffects.full'
import { setupVitePreloadErrorHandler } from '~/utils/setupVitePreloadErrorHandler'

// adding these so webpack won't tree shake this away, sideEffects was giving trouble
setupi18n()
setupWagmiAutoConnect()
setupVitePreloadErrorHandler()

if (!__GNOSIS_LEAN_BUILD__) {
  setupFullRuntimeSideEffects()
}
