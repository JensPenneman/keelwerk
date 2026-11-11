import type { GraphqlModule } from './graphql-module.ts';
import { graphqlTransport } from './graphql-transport.ts';

/** What `modules: [..., graphql]` lists. */
export const graphql: GraphqlModule = graphqlTransport();
