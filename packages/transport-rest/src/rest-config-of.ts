import type { RestConfig } from './rest-config.ts';

/** The defaults of the REST module's `config` shape (section 16.3.2). */
const defaults: RestConfig = { cors: [], docs: false, maxBodyBytes: 1_048_576 };

/**
 * The module's `config` of a backend as the transport reads it: a backend without a `rest` entry,
 * or with a partial one, gets the defaults of the module's shape.
 */
export function restConfigOf(held: unknown): RestConfig {
  if (typeof held !== 'object' || held === null) {
    return defaults;
  }
  const cors: unknown = Reflect.get(held, 'cors');
  const docs: unknown = Reflect.get(held, 'docs');
  const maxBodyBytes: unknown = Reflect.get(held, 'maxBodyBytes');
  return {
    cors: Array.isArray(cors)
      ? cors.filter((origin): origin is string => typeof origin === 'string')
      : defaults.cors,
    docs: typeof docs === 'boolean' ? docs : defaults.docs,
    maxBodyBytes:
      typeof maxBodyBytes === 'number' && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0
        ? maxBodyBytes
        : defaults.maxBodyBytes,
  };
}
