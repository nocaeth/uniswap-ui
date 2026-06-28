const fs = require('fs')
const { parseStringPromise, Builder } = require('xml2js')

function normalizeTokenAddressForCache(address) {
  if (address === 'NATIVE' || address === 'native') {
    return 'native'
  }

  if (address && typeof address === 'string' && address.startsWith('0x') && address.length === 42) {
    return address.toLowerCase()
  }

  return address
}

const weekMs = 7 * 24 * 60 * 60 * 1000
const nowISO = new Date().toISOString()
const SITE_ORIGIN = 'https://swap.gno.now'
const GNOSIS_CHAIN_ID = 100
const GNOSIS_CHAIN_NAME = 'gnosis'
const GNOSIS_TOKEN_LIST_URL =
  process.env.GNOSIS_TOKEN_LIST_URL ?? 'https://raw.githubusercontent.com/nocaeth/gc-tokenlist/main/token-list.json'
const SITEMAP_SCHEMA = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const SITEMAP_XSI = 'http://www.w3.org/2001/XMLSchema-instance'
const SITEMAP_SCHEMA_LOCATION =
  'http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd'

function createEmptyUrlSet() {
  return {
    urlset: {
      $: {
        xmlns: SITEMAP_SCHEMA,
        'xmlns:xsi': SITEMAP_XSI,
        'xsi:schemaLocation': SITEMAP_SCHEMA_LOCATION,
      },
      url: [],
    },
  }
}

async function readUrlSet(path) {
  if (!fs.existsSync(path)) {
    return createEmptyUrlSet()
  }

  const sitemap = await parseStringPromise(fs.readFileSync(path, 'utf8'))
  sitemap.urlset ??= createEmptyUrlSet().urlset
  sitemap.urlset.url ??= []
  return sitemap
}

function getLoc(url) {
  return Array.isArray(url.loc) ? url.loc[0] : url.loc
}

function refreshExistingUrls(sitemap, filterUrl) {
  sitemap.urlset.url = sitemap.urlset.url.filter((url) => {
    const loc = getLoc(url)
    return loc && filterUrl(loc)
  })

  sitemap.urlset.url.forEach((url) => {
    const lastMod = new Date(Array.isArray(url.lastmod) ? url.lastmod[0] : url.lastmod).getTime()
    if (!lastMod || lastMod < Date.now() - weekMs) {
      url.lastmod = [nowISO]
    }
  })

  return new Set(sitemap.urlset.url.map(getLoc).filter(Boolean))
}

function addUrl(sitemap, existingUrls, loc, priority) {
  if (existingUrls.has(loc)) {
    return
  }

  sitemap.urlset.url.push({
    loc: [loc],
    lastmod: [nowISO],
    priority: [priority],
  })
  existingUrls.add(loc)
}

function writeXml(path, data) {
  const builder = new Builder()
  fs.writeFileSync(path, `${builder.buildObject(data)}\n`)

  const fileSizeMegabytes = fs.statSync(path).size / (1024 * 1024)
  if (fileSizeMegabytes > 50) {
    throw new Error(`Generated ${path} file size exceeds 50MB`)
  }
}

async function fetchGnosisTokens() {
  const response = await fetch(GNOSIS_TOKEN_LIST_URL, {
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Gnosis token list: ${response.status} ${response.statusText}`)
  }

  const tokenList = await response.json()
  if (!Array.isArray(tokenList.tokens)) {
    throw new Error('Gnosis token list did not contain a tokens array')
  }

  return tokenList.tokens.filter((token) => token.chainId === GNOSIS_CHAIN_ID && token.address)
}

async function updateTokensSitemap() {
  const path = './public/tokens-sitemap.xml'
  const sitemap = await readUrlSet(path)
  const existingUrls = refreshExistingUrls(sitemap, (loc) => loc.includes(`/explore/tokens/${GNOSIS_CHAIN_NAME}/`))

  addUrl(sitemap, existingUrls, `${SITE_ORIGIN}/explore/tokens/${GNOSIS_CHAIN_NAME}/native`, 0.8)

  const tokens = await fetchGnosisTokens()
  tokens.forEach((token) => {
    addUrl(
      sitemap,
      existingUrls,
      `${SITE_ORIGIN}/explore/tokens/${GNOSIS_CHAIN_NAME}/${normalizeTokenAddressForCache(token.address)}`,
      0.8,
    )
  })

  writeXml(path, sitemap)
  console.log(`Tokens sitemap updated with ${existingUrls.size} Gnosis token URLs`)
}

async function updatePoolsSitemap() {
  const path = './public/pools-sitemap.xml'
  const sitemap = await readUrlSet(path)
  const existingUrls = refreshExistingUrls(sitemap, (loc) => loc.includes(`/explore/pools/${GNOSIS_CHAIN_NAME}/`))

  writeXml(path, sitemap)
  console.log(`Pools sitemap updated with ${existingUrls.size} preserved Gnosis pool URLs`)
}

function updateSitemapIndex() {
  writeXml('./public/sitemap.xml', {
    sitemapindex: {
      $: { xmlns: SITEMAP_SCHEMA },
      sitemap: [
        { loc: [`${SITE_ORIGIN}/app-sitemap.xml`] },
        { loc: [`${SITE_ORIGIN}/tokens-sitemap.xml`] },
        { loc: [`${SITE_ORIGIN}/pools-sitemap.xml`] },
      ],
    },
  })
  console.log('Sitemap index updated')
}

async function main() {
  await updateTokensSitemap()
  await updatePoolsSitemap()
  updateSitemapIndex()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
