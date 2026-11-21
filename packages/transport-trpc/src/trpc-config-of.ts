import type { TrpcConfig } from './trpc-config.ts';

/** The defaults of the tRPC module's `config` shape (section 16.3.2). */
const defaults: TrpcConfig = { cors: [], maxBodyBytes: 1_048_576, websocket: false };

/**
 * The module's `config` of a backend as the transport reads it: a backend without a `trpc` entry,
 * or with a partial one, gets the defaults of the module's shape.
 */
export function trpcConfigOf(held: unknown): TrpcConfig {
  if (typeof held !== 'object' || held === null) {
    return defaults;
  }
  const cors: unknown = Reflect.get(held, 'cors');
  const maxBodyBytes: unknown = Reflect.get(held, 'maxBodyBytes');
  const websocket: unknown = Reflect.get(held, 'websocket');
  return {
    cors: Array.isArray(cors)
      ? cors.filter((origin): origin is string => typeof origin === 'string')
      : defaults.cors,
    maxBodyBytes:
      typeof maxBodyBytes === 'number' && Number.isInteger(maxBodyBytes) && maxBodyBytes > 0
        ? maxBodyBytes
        : defaults.maxBodyBytes,
    websocket: typeof websocket === 'boolean' ? websocket : defaults.websocket,
  };
}
