import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import type { ConnectRouter } from '@connectrpc/connect'
import { createYoga } from 'graphql-yoga'
import { registerDataApiRoutes } from './dataApiService.js'
import { registerExploreRoutes } from './exploreService.js'
import { registerSearchRoutes } from './searchService.js'
import { schema } from './graphql.js'

const PORT = Number(process.env.PORT ?? 8081)

// ConnectRPC (ExploreStats + DataApiService positions) — the app reaches this at
// API_BASE_URL_V2_OVERRIDE. Connect routes by service typeName, so all services
// are mounted at the root.
const connectHandler = connectNodeAdapter({
  routes: (router: ConnectRouter) => {
    registerExploreRoutes(router)
    registerDataApiRoutes(router)
    registerSearchRoutes(router)
  },
})

// GraphQL (token/pool detail + charts) — the app reaches this at GRAPHQL_URL_OVERRIDE
// (point it at `<base>/v1/graphql`).
const yoga = createYoga({ schema, graphqlEndpoint: '/v1/graphql' })

// The web app runs on a different origin (e.g. http://localhost:3000) and calls
// ExploreStats over Connect's GET protocol from the browser, so permissive CORS
// (incl. preflight) is required. connectNodeAdapter does not add CORS itself.
function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', '*')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return true
  }
  return false
}

const server = createServer((req, res) => {
  if (applyCors(req, res)) {
    return
  }
  if (req.url?.startsWith('/v1/graphql')) {
    void yoga(req, res)
    return
  }
  connectHandler(req, res)
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`gnosis-analytics-adapter listening on :${PORT}`)
})
