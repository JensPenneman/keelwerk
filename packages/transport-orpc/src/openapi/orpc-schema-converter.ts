import type { ConditionalSchemaConverter, JSONSchema } from '@orpc/openapi';

function describedBy(schema: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const held: unknown = Reflect.get(schema, '~keelwerk');
  return typeof held === 'object' && held !== null
    ? Object.fromEntries(Object.entries(held))
    : undefined;
}

/**
 * Reads the schemas of this package (`NodeSchema`) for oRPC's OpenAPI generator: the JSON Schema of
 * the field node the schema stands for, in the direction of the conversion, so the OpenAPI document
 * of oRPC describes the same schemas as the surface does.
 */
export const orpcSchemaConverter: ConditionalSchemaConverter = {
  condition: (schema) => typeof describedBy(schema)?.describe === 'function',
  convert: (schema, options) => {
    const held = describedBy(schema);
    const describe = held?.describe;
    if (typeof describe !== 'function') {
      throw new TypeError('The schema does not describe a field node.');
    }
    const json = describe(options.strategy) as JSONSchema;
    return [held?.optional !== true, json];
  },
};
