import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { permissiveSchema } from './permissive-schema.ts';

/** The registry's schema for `output: typedOutput<T>()`: accepts any value and carries a marker the surface reads. */
export function typedOutputSchema(): StandardSchemaV1 {
  return Object.assign(permissiveSchema(), { typedOutput: true });
}
