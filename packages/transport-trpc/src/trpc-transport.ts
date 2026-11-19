import { contracts, defineTransportModule, field, shape } from '@keelwerk/core';
import { createTrpcAdapter } from './create-trpc-adapter.ts';
import type { TrpcModule } from './trpc-module.ts';
import type { TrpcStaticOptions } from './trpc-static-options.ts';

/**
 * The tRPC module (section 16.7). Static options make a new module value with the same id, so an
 * app still lists exactly one `trpc` module.
 */
export function trpcTransport(options: TrpcStaticOptions = {}): TrpcModule {
  return defineTransportModule({
    id: 'trpc',
    requires: [contracts.httpHost],
    config: shape({
      cors: field.list(field.string()).default([]),
      maxBodyBytes: field.integer({ min: 1024 }).default(1_048_576),
    }),
    transport: createTrpcAdapter(options),
  });
}
