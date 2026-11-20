import type { JsonSchema } from '@keelwerk/core';
import type { NodeSchema } from './node-schema.ts';

/** The schema of one field node for oRPC: it accepts every value as it is and carries its description. */
export function nodeSchemaOf(
  describe: (direction: 'input' | 'output') => JsonSchema,
  optional = false,
): NodeSchema {
  return {
    '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) },
    '~keelwerk': { describe, optional },
  };
}
