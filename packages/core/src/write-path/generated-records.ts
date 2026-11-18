import type { ActionEntry } from '../registry/action-entry.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An item of `create` without the `id` a client put in it: a created row's id is the kernel's,
 * never the client's.
 */
function withoutId(item: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(item).filter(([name]) => name !== 'id'));
}

/**
 * The items of a `create` or `update` list of a generated `set`; a map of items is read by its
 * values too, so a malformed input is covered.
 */
function itemsOf(
  input: Readonly<Record<string, unknown>>,
  operation: 'create' | 'update',
): readonly (readonly [string | number, unknown])[] {
  const items = input[operation];
  if (Array.isArray(items)) return items.map((item, index) => [index, item] as const);
  return isRecord(items) ? Object.entries(items) : [];
}

/**
 * A record inside the input of a generated write that holds the entity's own fields, and where it
 * sits.
 */
export interface GeneratedRecord {
  readonly path: readonly (string | number | symbol)[];
  readonly record: Readonly<Record<string, unknown>>;
  /**
   * What a subject path of a member is looked up in: the record without any `id` for a created
   * row, and the record with the row's `id` for an update (the `id` of the update wins over a
   * member of the patch named `id`).
   */
  readonly lookup: Readonly<Record<string, unknown>>;
}

/**
 * The records of the input of a generated `update` (its `patch`) or `set` (each item of `create`,
 * each `patch` of `update`) whose members are the entity's own fields. A client writes an entity's
 * personal fields through these, so the fingerprint of the command must treat their members as it
 * treats the members of a module command's input. Anything else has none.
 */
export function generatedRecordsOf(
  action: Pick<ActionEntry, 'generated'>,
  input: unknown,
): readonly GeneratedRecord[] {
  if (!isRecord(input)) return [];
  if (action.generated === 'update') {
    return isRecord(input.patch)
      ? [{ path: ['patch'], record: input.patch, lookup: { ...input.patch, id: input.id } }]
      : [];
  }
  if (action.generated !== 'set') return [];
  const found: GeneratedRecord[] = [];
  for (const [key, item] of itemsOf(input, 'create')) {
    if (isRecord(item))
      found.push({ path: ['create', key], record: item, lookup: withoutId(item) });
  }
  for (const [key, item] of itemsOf(input, 'update')) {
    if (isRecord(item) && isRecord(item.patch)) {
      found.push({
        path: ['update', key, 'patch'],
        record: item.patch,
        lookup: { ...item.patch, id: item.id },
      });
    }
  }
  return found;
}
