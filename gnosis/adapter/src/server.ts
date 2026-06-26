import { createServer } from 'node:http'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import { createYoga } from 'graphql-yoga'
import { registerExploreRoutes } from './exploreService.js'
import { schema } from './graphql.js'

const PORT = Number(process.env.PORT ?? 8081)

// ConnectRPC (ExploreStats etc.) — the app reaches this at API_BASE_URL_V2_OVERRIDE.
// Connect routes by service typeName, so it is mounted at the root.
const connectHandler = connectNodeAdapter({ routes: registerExploreRoutes })

// GraphQL (token/pool detail + charts) — the app reaches this at GRAPHQL_URL_OVERRIDE
// (point it at `<base>/v1/graphql`).
const yoga = createYoga({ schema, graphqlEndpoint: '/v1/graphql' })

const server = createServer((req, res) => {
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
