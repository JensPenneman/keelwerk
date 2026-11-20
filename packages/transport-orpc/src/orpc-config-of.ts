import type { OrpcConfig } from './orpc-config.ts';

/** The defaults of the oRPC module's `config` shape (section 16.3.2). */
const defaults: OrpcConfig = { cors: [], maxBodyBytes: 1_048_576 };

/**
 * The module's `config` of a backend as the transport reads it: a backend without an `orpc` entry,
 * or with a partial one, gets the defaults of the module's shape.
 */
export function orpcConfigOf(held: unknown): OrpcConfig {
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
