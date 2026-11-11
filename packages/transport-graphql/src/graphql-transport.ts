import { contracts, defineTransportModule, field, shape } from '@keelwerk/core';
import { createGraphqlAdapter } from './create-graphql-adapter.ts';
import type { GraphqlModule } from './graphql-module.ts';
import type { GraphqlStaticOptions } from './graphql-static-options.ts';

/**
 * The GraphQL module (section 16.3.2). Static options make a new module value with the same id, so
 * an app still lists exactly one `graphql` module.
 */
export function graphqlTransport(options: GraphqlStaticOptions = {}): GraphqlModule {
  return defineTransportModule({
    id: 'graphql',
    requires: [contracts.httpHost],
    config: shape({
      cors: field.list(field.string()).default([]),
      maxBodyBytes: field.integer({ min: 1024 }).default(1_048_576),
    }),
    transport: createGraphqlAdapter(options),
  });
}
