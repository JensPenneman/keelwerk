import { field } from '../fields/field.ts';
import type { AnyField } from '../fields/field-def.ts';
import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';
import { permissiveSchema } from './permissive-schema.ts';
import { rowShape } from './row-shape.ts';

function optionalFields(
  fields: Readonly<Record<string, AnyField>>,
): Readonly<Record<string, AnyField>> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, def]) => [name, def.flags.optional ? def : def.optional()]),
  );
}

/** The input and output schemas of one generated action. */
export interface GeneratedSchemas {
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
}

/**
 * The schemas of a generated action (section 6.7). Writes are shapes built from the entity's
 * fields; reads take the JMAP parameters loosely and return what the kernel assembles, because the
 * generated handlers and their exact wire forms belong to the write and read paths.
 */
export function generatedActionSchemas(
  kind: GeneratedActionKind,
  fields: Readonly<Record<string, AnyField>>,
): GeneratedSchemas {
  const row = rowShape(fields);
  const instance = { id: field.string(), ifVersion: field.integer().optional() };
  switch (kind) {
    case 'create':
      return { input: shape(fields), output: row };
    case 'update':
      return {
        input: shape({ ...instance, patch: field.json(shape(optionalFields(fields))) }),
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
    default:
      return { input: permissiveSchema(), output: permissiveSchema() };
  }
}
