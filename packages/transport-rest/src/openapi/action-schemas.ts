import type { SurfaceAction } from '@keelwerk/core';
import { toJsonSchema } from '@keelwerk/core';
import { bodyNodeOf } from './body-node-of.ts';
import type { JsonObject } from './json-object.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';

/**
 * The input and output schemas of an action (section 16.5.5); void sides have none. A `filter`
 * member of an entity's action points at the entity's recursive filter schema.
 */
export function actionSchemas(
  action: SurfaceAction,
  filterName: string | undefined,
): Record<string, JsonObject> {
  const schemas: Record<string, JsonObject> = {};
  const input = bodyNodeOf(action);
  if (input.kind !== 'void') {
    const schema: JsonObject = { ...toJsonSchema(input, { direction: 'input' }) };
    const properties = schema.properties as JsonObject | undefined;
    if (filterName !== undefined && properties?.filter !== undefined) {
      const described = (properties.filter as JsonObject).description;
      schema.properties = {
        ...properties,
        filter:
          described === undefined
            ? schemaRef(filterName)
            : { ...schemaRef(filterName), description: described },
      };
    }
    schemas[schemaName('input', action.ref)] = schema;
  }
  if (action.output.kind !== 'void') {
    schemas[schemaName('output', action.ref)] = {
      ...toJsonSchema(action.output, { direction: 'output' }),
    };
  }
  return schemas;
}
