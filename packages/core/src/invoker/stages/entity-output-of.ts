import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { AnyField } from '../../fields/field-def.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { EntityEntry } from '../../registry/entity-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import { systemFieldDefs } from '../../registry/system-field-defs.ts';

function shapeKeys(schema: unknown): ReadonlySet<string> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  if (!('kind' in schema) || schema.kind !== 'shape') return undefined;
  if (!('fields' in schema) || typeof schema.fields !== 'object' || schema.fields === null) {
    return undefined;
  }
  return new Set(Object.keys(schema.fields));
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** The keys of a row of the entity: its fields and the system fields, with and without the hidden ones. */
function rowKeys(entry: EntityEntry): readonly ReadonlySet<string>[] {
  const system = Object.keys(systemFieldDefs());
  const fields = Object.entries(entry.descriptor.fields);
  return [
    new Set([...system, ...fields.map(([name]) => name)]),
    new Set([...system, ...fields.filter(([, field]) => field.hidden === false).map(([n]) => n)]),
  ];
}

function entitiesOfRow(registry: Registry, schema: unknown): readonly EntityEntry[] {
  const keys = shapeKeys(schema);
  if (keys === undefined) return [];
  return [...registry.entities.values()].filter((entry) =>
    rowKeys(entry).some((candidate) => sameKeys(candidate, keys)),
  );
}

/** The invoked action's own entity when it is a candidate; a lone candidate; else the output is ambiguous. */
function entityOfRow(
  registry: Registry,
  action: ActionEntry,
  schema: unknown,
): EntityEntry | undefined {
  const candidates = entitiesOfRow(registry, schema);
  const [only] = candidates;
  if (candidates.length <= 1) return only;
  const own = action.entity === undefined ? undefined : registry.entities.get(action.entity);
  if (own !== undefined && candidates.includes(own)) return own;
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `The output of "${action.ref}" matches the rows of more than one entity (${candidates
      .map((entry) => entry.ref)
      .join(', ')}), so its read plan cannot be chosen.`,
  });
}

function jsonSchemaOf(field: AnyField | undefined): unknown {
  return field?.kind === 'json' ? field.options : undefined;
}

/** Where the entity rows are in an action's output. */
export interface EntityOutput {
  readonly form: 'row' | 'page';
  readonly entity: EntityEntry;
}

/**
 * The entity whose rows an action's output carries, read from the output schema: `rowOf(entity)`
 * compiles to the entity's row shape and `pageOf(entity)` to `{ items, pageInfo, queryState }`
 * with `items` a list of the row shape (the registry drops the `entityOutput` marker of 9.2 and
 * 16.2.2, so the entity is found by its field names: the action's own entity when several match,
 * `core.internal` when none of them is the action's). Undefined for a custom output, which holds
 * no entity row.
 */
export function entityOutputOf(registry: Registry, action: ActionEntry): EntityOutput | undefined {
  const output: unknown = action.output;
  const row = entityOfRow(registry, action, output);
  if (row !== undefined) return { form: 'row', entity: row };
  if (typeof output !== 'object' || output === null || !('fields' in output)) return undefined;
  const fields = output.fields as Readonly<Record<string, AnyField>>;
  if (action.page === undefined || fields.items?.kind !== 'list') return undefined;
  const entity = entityOfRow(registry, action, jsonSchemaOf(fields.items.inner ?? undefined));
  return entity === undefined ? undefined : { form: 'page', entity };
}
