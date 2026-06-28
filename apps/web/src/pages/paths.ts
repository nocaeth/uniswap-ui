// This is just an array of the app's defined paths that can be used in our Cloudflare Functions.
// Do not add any imports to this file.
// The array is kept up to date via the tests in src/pages/paths.test.ts

export const paths = [
  '/',
  '/explore',
  '/explore',
  '/explore/tokens/:chainName/:tokenAddress',
  '/tokens',
  '/tokens/:chainName',
  '/tokens/:chainName/:tokenAddress',
  '/explore/pools/:chainName/:poolAddress',
  '/swap',
  '/pool/new',
  '/pool',
  '/pool/:tokenId',
  '/pools/new',
  '/pools',
  '/pools/:tokenId',
  '/positions',
  '/positions/add',
  '/positions/add/new',
  '/positions/add/:chainName/:poolAddress',
  '/positions/create',
  '/positions/create/:protocolVersion',
  '/positions/v3/:chainName/:tokenId',
  '/add',
  '/increase',
  '/remove/:tokenId',
]
