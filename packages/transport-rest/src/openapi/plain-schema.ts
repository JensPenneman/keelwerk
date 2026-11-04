import type { FieldNode } from '@keelwerk/core';
import { toJsonSchema } from '@keelwerk/core';
import type { JsonObject } from './json-object.ts';

const annotations: ReadonlySet<string> = new Set([
  'default',
  'deprecated',
  'description',
  'readOnly',
  'writeOnly',
]);

/** The JSON Schema of a field node without annotations: what a value looks like, for parameters and filter operands. */
export function plainSchema(node: FieldNode): JsonObject {
  return Object.fromEntries(
    Object.entries(toJsonSchema(node, { direction: 'output' })).filter(
      ([keyword]) => !annotations.has(keyword),
    ),
  );
}
