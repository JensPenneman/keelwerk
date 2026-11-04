import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/** True for a schema `typedOutputSchema` made: the surface describes its result as an open object. */
export function isTypedOutputSchema(schema: StandardSchemaV1): boolean {
  return Reflect.get(schema, 'typedOutput') === true;
}
