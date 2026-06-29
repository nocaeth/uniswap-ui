import fs from 'fs'
import path from 'path'
import type { Plugin } from 'vite'

const LOCAL_ENV = '.env.local'

const CSP_DIRECTIVE_MAP: Record<string, string> = {
  defaultSrc: 'default-src',
  scriptSrc: 'script-src',
  styleSrc: 'style-src',
  imgSrc: 'img-src',
  frameSrc: 'frame-src',
  connectSrc: 'connect-src',
  workerSrc: 'worker-src',
  mediaSrc: 'media-src',
  fontSrc: 'font-src',
  formAction: 'form-action',
}

type CspMetaTagPluginOptions = {
  env?: Record<string, string | undefined>
  gnosisLeanBuild?: boolean
}

const GNOSIS_LEAN_HTML_PATTERNS = [
  /\n\s*<link rel="preconnect" href="https:\/\/mainnet\.infura\.io\/" crossorigin\/>/,
  /\n\s*<!-- Cloudflare Turnstile script - loaded early for CSP compliance -->\s*\n\s*<link rel="preconnect" href="https:\/\/challenges\.cloudflare\.com" crossorigin \/>\s*\n\s*<script id="cf-turnstile-script" src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" defer><\/script>/,
]

const GNOSIS_LEAN_HTML_REPLACEMENTS = [
  {
    pattern:
      /\n\s*<link rel="preload" href="\/fonts\/Basel-Grotesk-Book\.woff2" as="font" type="font\/woff2" crossorigin \/>\s*\n\s*<link rel="preload" href="\/fonts\/Basel-Grotesk-Medium\.woff2" as="font" type="font\/woff2" crossorigin \/>/,
    replacement: '\n    <link rel="preload" href="/fonts/Inter-Regular-Latin.woff2" as="font" type="font/woff2" crossorigin />',
  },
  {
    pattern:
      /\n\s*\/\*\*\s*\n\s*Explicitly load Basel var from public\/ so it does not block LCP's critical path\.\s*\n\s*\*\/\s*\n\s*@font-face\s*\{\s*\n\s*font-family: 'Basel';\s*\n\s*font-weight: 535;\s*\n\s*font-style: normal;\s*\n\s*font-display: block;\s*\n\s*src:\s*\n\s*url\('\/fonts\/Basel-Grotesk-Medium\.woff2'\) format\('woff2'\),\s*\n\s*url\('\/fonts\/Basel-Grotesk-Medium\.woff'\) format\('woff'\);\s*\n\s*\}\s*\n\s*@font-face\s*\{\s*\n\s*font-family: 'Basel';\s*\n\s*font-weight: 485;\s*\n\s*font-style: normal;\s*\n\s*font-display: block;\s*\n\s*src:\s*\n\s*url\('\/fonts\/Basel-Grotesk-Book\.woff2'\) format\('woff2'\),\s*\n\s*url\('\/fonts\/Basel-Grotesk-Book\.woff'\) format\('woff'\);\s*\n\s*\}/,
    replacement: '',
  },
  {
    pattern: /\/\* Subsetted Inter Regular, fetched lazily only when the Privy watermark renders \(PrivyWatermark\.tsx\)\. \*\//,
    replacement: '/* Subsetted Inter Regular used as the critical web font. */',
  },
  {
    pattern: /\n\s*@supports \(font-variation-settings: normal\) \{\s*\n\s*\*\s*\{\s*\n\s*font-family: 'Basel', sans-serif;\s*\n\s*\}\s*\n\s*\}/,
    replacement: '',
  },
  {
    pattern: /font-family: 'Basel', sans-serif;/g,
    replacement:
      'font-family: \'Inter\', -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
  },
]

const GNOSIS_LEAN_CSP_ORIGINS = new Set([
  'https://challenges.cloudflare.com',
  'https://browser-intake-datadoghq.com',
  'https://statsigapi.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://fonts.gstatic.com/s/inter/v18/*',
  'https://*.alchemy.com',
  'https://*.coinbase.com',
  'https://*.coingecko.com/',
  'https://*.coinmarketcap.com/',
  'https://*.googleapis.com',
  'https://*.infura.io',
  'https://*.nodereal.io',
  'https://*.quiknode.pro',
  'https://api.statsig.com',
  'https://featuregates.org',
  'https://events.statsigapi.net',
  'https://api.statsigcdn.com',
  'https://featureassets.org',
  'https://assetsconfigcdn.org',
  'https://prodregistryv2.org',
  'https://rpc.ankr.com',
  'https://sockjs-us3.pusher.com/',
  'wss://ws-us3.pusher.com/',
])

const GNOSIS_LEAN_CONNECT_SRC_ORIGIN_ENV_KEYS = [
  'API_BASE_URL_V2_OVERRIDE',
  'GRAPHQL_URL_OVERRIDE',
  'REACT_APP_GNOSIS_RPC_URL',
] as const

function stripGnosisLeanCspOrigins(csp: Record<string, string[]>): void {
  for (const [key, values] of Object.entries(csp)) {
    csp[key] = values.filter((value) => !GNOSIS_LEAN_CSP_ORIGINS.has(value))
  }
}

function addConnectSrcOrigin(csp: Record<string, string[]>, url: string): void {
  try {
    const origin = new URL(url).origin
    csp.connectSrc ??= []
    if (!csp.connectSrc.includes(origin)) {
      csp.connectSrc.push(origin)
    }
  } catch {
    // ignore malformed override URLs
  }
}

function getConfiguredEnvUrl(envUrlKey: string, options: CspMetaTagPluginOptions): string | null {
  return options.env?.[envUrlKey] ?? process.env[envUrlKey] ?? getLocalEnvUrl(envUrlKey)
}

function addGnosisLeanConnectSrcOverrides(csp: Record<string, string[]>, options: CspMetaTagPluginOptions): void {
  if (!options.gnosisLeanBuild) {
    return
  }

  for (const envUrlKey of GNOSIS_LEAN_CONNECT_SRC_ORIGIN_ENV_KEYS) {
    const overrideValue = getConfiguredEnvUrl(envUrlKey, options)
    if (overrideValue) {
      addConnectSrcOrigin(csp, overrideValue)
    }
  }
}

function stripGnosisLeanHtml(html: string): string {
  const strippedHtml = GNOSIS_LEAN_HTML_PATTERNS.reduce((result, pattern) => result.replace(pattern, ''), html)
  return GNOSIS_LEAN_HTML_REPLACEMENTS.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    strippedHtml,
  )
}

// This plugin is used in vite.config.mts
// oxlint-disable-next-line import/no-unused-modules
export function cspMetaTagPlugin(mode?: string, options: CspMetaTagPluginOptions = {}): Plugin {
  return {
    name: 'inject-csp-meta',

    writeBundle() {
      if (!options.gnosisLeanBuild) {
        return
      }

      for (const outputCSPPath of [
        path.resolve(process.cwd(), 'build', 'csp.json'),
        path.resolve(process.cwd(), 'build', 'client', 'csp.json'),
      ]) {
        if (!fs.existsSync(outputCSPPath)) {
          continue
        }

        const outputCSP = JSON.parse(fs.readFileSync(outputCSPPath, 'utf-8'))
        stripGnosisLeanCspOrigins(outputCSP)
        addGnosisLeanConnectSrcOverrides(outputCSP, options)
        fs.writeFileSync(outputCSPPath, `${JSON.stringify(outputCSP, null, 2)}\n`)
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        const env = mode ?? process.env.NODE_ENV ?? 'development'
        const skip = process.env.SKIP_CSP === 'true'

        if (skip) {
          return html
        }

        // Load base CSP - adjust path to be relative to the project root
        const baseCSPPath = path.resolve(process.cwd(), 'public', 'csp.json')
        const baseCSP = JSON.parse(fs.readFileSync(baseCSPPath, 'utf-8'))
        let transformedHtml = html

        if (options.gnosisLeanBuild) {
          stripGnosisLeanCspOrigins(baseCSP)
          transformedHtml = stripGnosisLeanHtml(transformedHtml)
        }

        // Optionally extend with dev/staging
        const envConfigFile = env === 'development' ? 'dev-csp.json' : env === 'staging' ? 'staging-csp.json' : null

        if (envConfigFile) {
          const extraCSPPath = path.resolve(process.cwd(), 'public', envConfigFile)
          const extraCSP = JSON.parse(fs.readFileSync(extraCSPPath, 'utf-8'))
          for (const [key, value] of Object.entries(extraCSP)) {
            if (Array.isArray(value)) {
              baseCSP[key] = [...new Set([...(baseCSP[key] || []), ...value])]
            }
          }
        }

        const tradingApiUrlOverride =
          getLocalEnvUrl('TRADING_API_URL_OVERRIDE') ?? getLocalEnvUrl('REACT_APP_TRADING_API_URL_OVERRIDE')
        if (tradingApiUrlOverride) {
          if (!baseCSP.connectSrc.includes(tradingApiUrlOverride)) {
            baseCSP.connectSrc.push(tradingApiUrlOverride)
          }
        }

        // Self-hosted Gnosis deployments repoint the data/GraphQL layer at a custom
        // host (the analytics adapter) via these overrides. Allow their origins in
        // connect-src for ALL modes (dev reads .env.local; the Docker build passes
        // them as process.env) so the browser can reach the adapter.
        for (const overrideKey of ['API_BASE_URL_V2_OVERRIDE', 'GRAPHQL_URL_OVERRIDE']) {
          const overrideValue = getConfiguredEnvUrl(overrideKey, options)
          if (!overrideValue) {
            continue
          }
          addConnectSrcOrigin(baseCSP, overrideValue)
        }

        addGnosisLeanConnectSrcOverrides(baseCSP, options)

        // Transform the CSP content using the directive map
        const cspContent = Object.entries(baseCSP)
          .map(([key, values]) => {
            const directive = CSP_DIRECTIVE_MAP[key]
            if (!directive) {
              // Log unknown directives in development only
              if (env === 'development') {
                // oxlint-disable-next-line no-console -- Required for Vite build debugging
                console.warn(`Unknown CSP directive: ${key}`)
              }
              return null
            }

            return `${directive} ${(values as string[]).join(' ')}`
          })
          .filter(Boolean)
          .join('; ')

        const escapedContent = cspContent
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')

        // Replace the comment with the CSP meta tag
        return transformedHtml.replace(
          /<!-- CSP will be injected here -->/,
          `<meta http-equiv="Content-Security-Policy" content="${escapedContent}">`,
        )
      },
    },
  }
}

/**
 * For development builds, gets the target envUrlKey from the local env
 * file and returns the value.
 */
const getLocalEnvUrl = (envUrlKey: string) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return null
    }
    const localEnvPath = path.resolve(process.cwd(), LOCAL_ENV)
    if (fs.existsSync(localEnvPath)) {
      const envContent = fs.readFileSync(localEnvPath, 'utf-8')
      const lines = envContent.split('\n')

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine.startsWith('#')) {
          continue
        }
        if (trimmedLine.startsWith(`${envUrlKey}=`)) {
          const value = trimmedLine.split('=')[1]?.trim().replace(/^["']|["']$/g, '') || ''
          if (value) {
            try {
              new URL(value)
              return value
            } catch (_e) {
              // oxlint-disable-next-line no-console -- Required for Vite build debugging
              console.warn(`Invalid URL found for ${envUrlKey}: ${value}`)
              return null
            }
          }
        }
      }
    }
    return null
  } catch (error) {
    // oxlint-disable-next-line no-console -- Required for Vite build debugging
    console.error(`Error retrieving environment URL for ${envUrlKey}:`, error)
    return null
  }
}
