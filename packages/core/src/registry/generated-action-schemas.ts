import { field } from '../fields/field.ts';
import type { AnyField } from '../fields/field-def.ts';
import { patchShape } from '../fields/patch-shape.ts';
import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';
import { permissiveSchema } from './permissive-schema.ts';
import { rowShape } from './row-shape.ts';

/** The input and output schemas of one generated action. */
export interface GeneratedSchemas {
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
}

/**
 * The schemas of a generated action (section 6.7). Writes are shapes built from the entity's
 * fields; reads take the JMAP parameters loosely and return what the kernel assembles, because the
 * generated handlers and their exact wire forms belong to the write and read paths. The ids of a
 * watch are checked as the entity's own id is: a text that is no id of the entity is `validation`,
 * not an empty stream (a carrier has turned a TypeID of the surface into the id by then).
 */
export function generatedActionSchemas(
  kind: GeneratedActionKind,
  fields: Readonly<Record<string, AnyField>>,
  entity: string,
): GeneratedSchemas {
  const row = rowShape(fields);
  const instance = { id: field.string(), ifVersion: field.integer().optional() };
  switch (kind) {
    case 'create':
      return { input: shape(fields), output: row };
    case 'update':
      return {
        input: shape({ ...instance, patch: field.json(patchShape(fields)) }),
        output: row,
      };
    case 'archive':
    case 'restore':
      return { input: shape(instance), output: row };
    case 'get':
      return {
        input: shape({
          ids: field.list(field.string()),
          properties: field.list(field.string()).optional(),
          asOf: field.instant().optional(),
          includeArchived: field.boolean().optional(),
        }),
        output: permissiveSchema(),
      };
    case 'history':
      return {
        input: shape({
          id: field.string(),
          asOf: field.instant().optional(),
          fromVersion: field.integer().optional(),
          limit: field.integer().optional(),
        }),
        output: permissiveSchema(),
      };
    case 'watch':
      return {
        input: shape({
          ids: field.list(field.ref.own(entity)).optional(),
          filter: field.json(permissiveSchema()).optional(),
          fields: field.list(field.string()).optional(),
          includeArchived: field.boolean().optional(),
          from: field.enum(['now', 'beginning']).optional(),
          after: field.string().optional(),
          partition: field.string().optional(),
        }),
        // Items are built by the kernel and never validated (set-up-subscription.ts itemOf).
        output: permissiveSchema(),
      };
    default:
      return { input: permissiveSchema(), output: permissiveSchema() };
  }
}
