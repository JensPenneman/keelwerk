import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/** A schema that accepts any value: the stand-in for inputs and outputs the registry cannot derive. */
export function permissiveSchema(): StandardSchemaV1 {
  return { '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) } };
}
