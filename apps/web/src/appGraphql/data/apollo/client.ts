import { ApolloClient, from, HttpLink } from '@apollo/client'
import { UNISWAP_WEB_URL } from 'uniswap/src/constants/urls'
import { setupSharedApolloCache } from 'uniswap/src/data/cache'
import { getDatadogApolloLink } from 'utilities/src/logger/datadog/datadogLink'
import { getRetryLink } from '~/appGraphql/data/apollo/retryLink'
import { getConfig } from '~/config'

// Gnosis-only: GRAPHQL_URL_OVERRIDE (the self-hosted adapter) wins over the Uniswap
// gateway, which does not serve Gnosis. Falls back to awsApiEndpoint when unset.
const httpLink = new HttpLink({ uri: getConfig().graphqlUrlOverride || getConfig().awsApiEndpoint })
const datadogLink = getDatadogApolloLink()
const retryLink = getRetryLink()

export const apolloClient = new ApolloClient({
  connectToDevTools: true,
  link: from([datadogLink, retryLink, httpLink]),
  headers: {
    'Content-Type': 'application/json',
    Origin: UNISWAP_WEB_URL,
  },
  cache: setupSharedApolloCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
})
