import { compareCodePoints } from '../conditions/compare-code-points.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import { isTypedOutputSchema } from '../registry/is-typed-output-schema.ts';
import type { FieldNode } from './field-node.ts';
import { generatedNodes } from './generated-action-nodes.ts';
import type { PageSpec } from './page-spec.ts';
import { type SchemaNodeContext, schemaNodeOf } from './schema-node-of.ts';
import type { SurfaceAction } from './surface-action.ts';
import type { SurfaceEntity } from './surface-entity.ts';
import { surfaceHash } from './surface-hash.ts';

/** The result of a typed output (F-11b): an open object, whatever the type behind it. */
const document: FieldNode = {
  optional: false,
  access: 'read-write',
  kind: 'foreign',
  input: { type: 'object' },
  output: { type: 'object' },
};

const voidNode: FieldNode = { optional: false, access: 'read-write', kind: 'void' };

function rowOf(entity: SurfaceEntity): FieldNode {
  return { optional: false, access: 'read-write', kind: 'shape', fields: entity.fields };
}

/** True when a schema is the row shape of the entity: a shape with exactly the member names of the registry's row. */
function isRowOf(schema: StandardSchemaV1, names: ReadonlySet<string> | undefined): boolean {
  const fields: unknown = Reflect.get(schema, 'fields');
  if (names === undefined || typeof fields !== 'object' || fields === null) return false;
  const own = Object.keys(fields);
  return own.length === names.size && own.every((name) => names.has(name));
}

function withoutEmptyShape(node: FieldNode): FieldNode {
  return node.kind === 'shape' && Object.keys(node.fields).length === 0 ? voidNode : node;
}

/** The `id` of an instance command is the entity's reference, whatever the registry's plain string said. */
function withEntityId(node: FieldNode, entity: SurfaceEntity | undefined): FieldNode {
  if (node.kind !== 'shape' || entity === undefined || node.fields.id === undefined) return node;
  return {
    ...node,
    fields: {
      ...node.fields,
      id: {
        optional: false,
        access: 'read-write',
        kind: 'ref',
        target: entity.ref,
        prefix: entity.prefix,
      },
    },
  };
}

function pageItemSchema(output: StandardSchemaV1): StandardSchemaV1 | undefined {
  const items: unknown =
    typeof output === 'object'
      ? Reflect.get(Reflect.get(output, 'fields') ?? {}, 'items')
      : undefined;
  const inner: unknown =
    typeof items === 'object' && items !== null ? Reflect.get(items, 'inner') : undefined;
  const options: unknown =
    typeof inner === 'object' && inner !== null ? Reflect.get(inner, 'options') : undefined;
  return typeof options === 'object' && options !== null
    ? (options as StandardSchemaV1)
    : undefined;
}

function pageSpecOf(page: PageSpec): PageSpec {
  return { ...page, sortable: [...page.sortable].sort(compareCodePoints) };
}

/** What describing one action needs of the rest of the surface. */
export interface SurfaceActionContext {
  /** The entities of the surface by reference. */
  readonly entities: ReadonlyMap<string, SurfaceEntity>;
  readonly prefixOf: (entityRef: string) => string | undefined;
  /** The member names of each entity's row as the registry's row shape has them: system fields, hidden ones and verifiers included. */
  readonly rowNames: ReadonlyMap<string, ReadonlySet<string>>;
}

/** An action of the surface and the problems met describing it. */
export interface SurfaceActionResult {
  readonly action: SurfaceAction;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The action of the surface (section 16.2.2). Generated actions take the nodes written over their
 * entity; custom ones take the nodes of their registry schemas, an empty shape becoming `void`, the
 * `id` of an instance command the entity's reference, and a paged query's output a `page` of the
 * entity's row. An input or output no transport could describe becomes open `foreign` and is reported.
 */
export function surfaceActionOf(
  entry: ActionEntry,
  context: SurfaceActionContext,
): SurfaceActionResult {
  const problems: CompositionProblem[] = [];
  const entity = entry.entity === undefined ? undefined : context.entities.get(entry.entity);
  const names = entry.entity === undefined ? undefined : context.rowNames.get(entry.entity);
  const schemaContext: SchemaNodeContext = {
    declaredBy: entry.module,
    prefixOf: context.prefixOf,
  };
  const described = (schema: StandardSchemaV1, side: string): FieldNode => {
    const result = schemaNodeOf(schema, schemaContext);
    if (result.problem !== undefined) {
      problems.push(
        compositionError('unsurfacedSchemas', `${entry.ref} ${side}: ${result.problem}`, {
          module: entry.module,
          ref: entry.ref,
        }),
      );
    }
    return result.node;
  };
  let input: FieldNode;
  let output: FieldNode;
  if (entry.generated !== undefined && entity !== undefined) {
    ({ input, output } = generatedNodes(entry.generated, entity));
  } else {
    input = withEntityId(
      withoutEmptyShape(described(entry.input, 'input')),
      entry.instance ? entity : undefined,
    );
    const itemSchema = entry.page === undefined ? undefined : pageItemSchema(entry.output);
    if (isTypedOutputSchema(entry.output)) {
      output = document;
    } else if (itemSchema !== undefined) {
      output = {
        optional: false,
        access: 'read-write',
        kind: 'page',
        item:
          entity !== undefined && isRowOf(itemSchema, names)
            ? rowOf(entity)
            : described(itemSchema, 'output'),
      };
    } else if (entity !== undefined && isRowOf(entry.output, names)) {
      output = rowOf(entity);
    } else {
      output = withoutEmptyShape(described(entry.output, 'output'));
    }
  }
  const action: SurfaceAction = {
    ref: entry.ref,
    module: entry.module,
    ...(entry.entity === undefined ? {} : { entity: entry.entity }),
    name: entry.name,
    mount: entry.mount,
    kind: entry.kind,
    ...(entry.generated === undefined ? {} : { generated: entry.generated }),
    instance: entry.instance,
    input,
    output,
    errors: [...entry.errors].sort(compareCodePoints),
    auth: entry.auth,
    scope: entry.scope,
    execution: entry.execution,
    idempotent: entry.idempotent,
    offline: entry.offline,
    resumable: entry.resumable,
    ...(entry.page === undefined ? {} : { page: pageSpecOf(entry.page) }),
    ...(entry.timeoutMs === undefined ? {} : { timeoutMs: entry.timeoutMs }),
    hints: entry.hints,
    ...(entry.contributedBy === undefined ? {} : { contributedBy: entry.contributedBy }),
    ...(entry.description === undefined ? {} : { description: entry.description }),
    ...(entry.deprecated === undefined ? {} : { deprecated: entry.deprecated }),
    since: entry.since,
    changedIn: [...entry.changedIn].sort(compareCodePoints),
    inputHash: surfaceHash(input),
    outputHash: surfaceHash(output),
  };
  return { action, problems };
}
