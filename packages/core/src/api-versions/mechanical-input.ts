import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { entityPositions } from './entity-positions.ts';
import { fieldChangesOf } from './field-changes-of.ts';
import { inputNamesRequired } from './input-names-required.ts';
import { isMemberRecord } from './is-member-record.ts';
import { reachAt } from './reach-at.ts';
import { renameCondition } from './rename-condition.ts';
import { renameKey } from './rename-key.ts';
import { rewritePositions } from './rewrite-positions.ts';

function rowIn(
  row: unknown,
  changes: ReturnType<typeof fieldChangesOf>,
  defaults: Readonly<Record<string, unknown>> | undefined,
  headNameOf: (entity: string, name: string) => string,
): unknown {
  if (!isMemberRecord(row)) return row;
  let next = row;
  for (const change of changes) {
    if (change.kind === 'renamed') {
      next = renameKey(next, change.was, change.field);
    } else if (change.kind === 'removed') {
      if (Object.hasOwn(next, change.field)) {
        next = Object.fromEntries(Object.entries(next).filter(([key]) => key !== change.field));
      }
    } else {
      const head = headNameOf(change.entity, change.field);
      if (
        defaults !== undefined &&
        !Object.hasOwn(next, change.field) &&
        Object.hasOwn(defaults, head)
      ) {
        next = { ...next, [change.field]: defaults[head] };
      }
    }
  }
  return next;
}

/**
 * The defaults an added required field takes in the rows that create: a generated `create` and the
 * `create` items of `set` take every default of the entity; a declared action only those its own
 * input schema names as required members (a member it marks optional is left out by a head caller
 * too, and an action that edits a row must not write a default over the stored value), since a plain
 * action shape changes through custom transforms.
 */
function creatingDefaults(
  registry: Registry,
  action: ActionEntry,
  entity: string,
): Readonly<Record<string, unknown>> | undefined {
  const defaults = registry.entities.get(entity)?.behaviour?.defaults;
  if (defaults === undefined || action.generated === 'create' || action.generated === 'set') {
    return defaults;
  }
  if (action.generated !== undefined) return undefined;
  return Object.fromEntries(
    Object.entries(defaults).filter(([name]) => inputNamesRequired(action, name)),
  );
}

/**
 * The mechanical half of one change's input translation (older to head): fields renamed in rows,
 * selections, sorts and filters, a removed field dropped from rows, and an added required field
 * given the entity's declared default in the rows that create (never in a patch). `later` are the
 * lacking changes newer than this one: a field added here and renamed later takes the default of
 * its head name. A selection that names a removed field loses the name; when `producesRemoved`
 * (the change has a custom output transform for this action, which can build the field from other
 * members) the whole selection goes instead, so the head answers everything the caller may read
 * and the answer is narrowed to the caller's selection again (`narrowToSelection`).
 */
export function mechanicalInput(
  registry: Registry,
  change: VersionChangeEntry,
  action: ActionEntry,
  value: unknown,
  later: readonly VersionChangeEntry[] = [],
  producesRemoved = false,
): unknown {
  const positions = entityPositions(action);
  const all = fieldChangesOf(change);
  if (positions === undefined || all.length === 0) return value;
  const own = all.filter((item) => item.entity === positions.entity);
  const defaults = creatingDefaults(registry, action, positions.entity);
  const renamedAt = (entity: string, name: string): string =>
    all.find((item) => item.kind === 'renamed' && item.entity === entity && item.was === name)
      ?.field ?? name;
  const newer = later.flatMap(fieldChangesOf);
  const headNameOf = (entity: string, name: string): string =>
    newer.reduce(
      (current, item) =>
        item.kind === 'renamed' && item.entity === entity && item.was === current
          ? item.field
          : current,
      name,
    );
  const targetOf = (entity: string, relation: string): string | undefined =>
    registry.entities.get(entity)?.descriptor.relations[relation]?.target;
  let next = value;
  for (const path of positions.inputRows) {
    const creates = path.at(-1) !== 'patch';
    next = rewritePositions(next, path, (row) =>
      rowIn(row, own, creates ? defaults : undefined, headNameOf),
    );
  }
  const removed = new Set(own.filter((item) => item.kind === 'removed').map((item) => item.field));
  for (const path of positions.selections) {
    const names = reachAt(next, path).flatMap((reached) =>
      Array.isArray(reached.value) ? (reached.value as readonly unknown[]) : [],
    );
    if (producesRemoved && names.some((name) => typeof name === 'string' && removed.has(name))) {
      const key = path.at(-1);
      if (key === undefined) continue;
      next = rewritePositions(next, path.slice(0, -1), (parent) =>
        isMemberRecord(parent)
          ? Object.fromEntries(Object.entries(parent).filter(([name]) => name !== key))
          : parent,
      );
      continue;
    }
    next = rewritePositions(next, path, (list) =>
      Array.isArray(list)
        ? list.flatMap((name: unknown) =>
            typeof name === 'string'
              ? removed.has(name)
                ? []
                : [renamedAt(positions.entity, name)]
              : [name],
          )
        : list,
    );
  }
  for (const path of positions.sorts) {
    next = rewritePositions(next, path, (keys) =>
      Array.isArray(keys)
        ? keys.map((key: unknown) =>
            isMemberRecord(key) && typeof key.field === 'string'
              ? { ...key, field: renamedAt(positions.entity, key.field) }
              : key,
          )
        : keys,
    );
  }
  for (const path of positions.filters) {
    next = rewritePositions(next, path, (filter) =>
      renameCondition(filter, positions.entity, renamedAt, targetOf),
    );
  }
  return next;
}
