import type { GraphqlConfig } from './graphql-config.ts';

/** The defaults of the GraphQL module's `config` shape (section 16.3.2). */
const defaults: GraphqlConfig = { cors: [], maxBodyBytes: 1_048_576 };

/**
 * The module's `config` of a backend as the transport reads it: a backend without a `graphql`
 * entry, or with a partial one, gets the defaults of the module's shape.
 */
export function graphqlConfigOf(held: unknown): GraphqlConfig {
  if (typeof held !== 'object' || held === null) {
    return defaults;
  }
  const cors: unknown = Reflect.get(held, 'cors');
  const maxBodyBytes: unknown = Reflect.get(held, 'maxBodyBytes');
  return {
    cors: Array.isArray(cors)
      ? cors.filter((origin): origin is string => typeof origin === 'string')
      : defaults.cors,
    maxBodyBytes:
      typeof maxBodyBytes === 'number' && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0
        ? maxBodyBytes
        : defaults.maxBodyBytes,
  };
}
