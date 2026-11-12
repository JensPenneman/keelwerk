import type { FieldNode, SurfaceEntity } from '@keelwerk/core';
import { patchMemberOf, toJsonSchema } from '@keelwerk/core';
import type { JsonObject } from './json-object.ts';
import { schemaName } from './schema-name.ts';

function shapeOf(fields: Readonly<Record<string, FieldNode>>): FieldNode {
  return { kind: 'shape', optional: false, access: 'read-write', fields };
}

/** The read, create and patch schemas of an entity (section 16.5.5); a read row lists the names a mask hid in `$masked` (section 16.4.5). */
export function entitySchemas(entity: SurfaceEntity): Record<string, JsonObject> {
  const read = { ...toJsonSchema(shapeOf(entity.fields), { direction: 'output' }) };
  const create = { ...toJsonSchema(shapeOf(entity.fields), { direction: 'input' }) };
  const patchFields = Object.fromEntries(
    Object.entries(entity.fields).map(([name, node]) => [name, patchMemberOf(node)]),
  );
  const patch = toJsonSchema(shapeOf(patchFields), { direction: 'input' });
  return {
    [schemaName('read', entity.ref)]: {
      ...read,
      properties: {
        ...(read.properties as JsonObject),
        $masked: { type: 'array', items: { type: 'string' } },
      },
      ...(entity.description === undefined ? {} : { description: entity.description }),
    },
    [schemaName('create', entity.ref)]: create,
    [schemaName('patch', entity.ref)]: patch,
  };
}
