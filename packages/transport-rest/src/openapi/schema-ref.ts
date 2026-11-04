import type { JsonObject } from './json-object.ts';

/** A reference to a schema in `components.schemas`. */
export function schemaRef(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}
