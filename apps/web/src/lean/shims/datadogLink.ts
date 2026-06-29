import { ApolloLink } from '@apollo/client'

export const getDatadogApolloLink = (): ApolloLink => new ApolloLink((operation, forward) => forward(operation))
