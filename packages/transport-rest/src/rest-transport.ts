import { contracts, defineTransportModule, field, shape } from '@keelwerk/core';
import { createRestAdapter } from './create-rest-adapter.ts';
import type { RestStaticOptions } from './rest-static-options.ts';

/**
 * The REST module (section 16.3.2). Static options make a new module value with the same id, so an
 * app still lists exactly one `rest` module.
 */
export const restTransport = (options: RestStaticOptions = {}) =>
  defineTransportModule({
    id: 'rest',
    requires: [contracts.httpHost],
    config: shape({
      cors: field.list(field.string()).default([]),
      docs: field.boolean().default(false),
      maxBodyBytes: field.integer({ min: 1024 }).default(1_048_576),
    }),
    transport: createRestAdapter(options),
  });
