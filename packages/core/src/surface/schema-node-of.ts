import { field } from '../fields/field.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { anyValue } from './any-value.ts';
import type { FieldNode } from './field-node.ts';
import { fieldNodeOf } from './field-node-of.ts';

/** The schemas the registry substitutes for inputs and outputs it cannot derive (`permissiveSchema`). */
function isPermissive(schema: StandardSchemaV1): boolean {
  const standard: unknown = schema['~standard'];
  return (
    typeof standard === 'object' &&
    standard !== null &&
    Reflect.get(standard, 'vendor') === 'keelwerk' &&
    Reflect.get(standard, 'jsonSchema') === undefined &&
    Reflect.get(schema, 'kind') === undefined
  );
}

/** The node without the tag `fieldNodeOf` gives a top-level node: a schema is not a member of anything. */
function untagged(node: FieldNode): FieldNode {
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'tag')) as FieldNode;
}

/** What a schema's node needs to know of the place the schema sits in. */
export interface SchemaNodeContext {
  /** The module whose `own` references the schema's fields resolve against. */
  readonly declaredBy: string;
  readonly prefixOf: (entityRef: string) => string | undefined;
}

/** A node and, when the schema could not be described, the reason. */
export interface SchemaNode {
  readonly node: FieldNode;
  readonly problem?: string;
}

/**
 * The field node of a Standard Schema: a `shape` becomes a `shape` node (verifier and hidden members
 * left out), the registry's permissive stand-in becomes `foreign` with open schemas, any other
 * schema becomes a `json` node through its Standard JSON Schema. A schema no transport could
 * describe becomes `foreign` with the reason, which the caller turns into a compose problem.
 */
export function schemaNodeOf(schema: StandardSchemaV1, context: SchemaNodeContext): SchemaNode {
  if (isPermissive(schema)) return { node: anyValue };
  try {
    return {
      node: untagged(
        fieldNodeOf(field.json(schema), {
          declaredBy: context.declaredBy,
          tag: 1,
          prefixOf: context.prefixOf,
        }),
      ),
    };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { node: anyValue, problem: error.message };
  }
}
