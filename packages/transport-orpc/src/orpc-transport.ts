import { contracts, defineTransportModule, field, shape } from '@keelwerk/core';
import { createOrpcAdapter } from './create-orpc-adapter.ts';
import type { OrpcModule } from './orpc-module.ts';
import type { OrpcStaticOptions } from './orpc-static-options.ts';

/**
 * The oRPC module (section 16.7.7). Static options make a new module value with the same id, so an
 * app still lists exactly one `orpc` module.
 */
export function orpcTransport(options: OrpcStaticOptions = {}): OrpcModule {
  return defineTransportModule({
    id: 'orpc',
    requires: [contracts.httpHost],
    config: shape({ cors: field.list(field.string()).default([]) }),
    transport: createOrpcAdapter(options),
  });
}
