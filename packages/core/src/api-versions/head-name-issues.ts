import type { ErrorIssue } from '../errors/error-issue.ts';
import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import type { EntityPositions } from './entity-positions.ts';
import { fieldChangesOf } from './field-changes-of.ts';
import { isMemberRecord } from './is-member-record.ts';
import { reachAt } from './reach-at.ts';
import { relationTarget } from './relation-target.ts';

type Path = readonly (string | number)[];

const quantifiers: ReadonlySet<string> = new Set(['some', 'none', 'every', 'is']);
const refusal = 'is not a field of this shape';

/**
 * The field names of a filter in the object form of section 16.4.4, with the entity each belongs
 * to and the path to its key: `and`, `or` and `not` recurse, and a relation (a name, a dotted
 * path or nested relation objects) steps through `targetOf` to the entity its quantifier filters.
 */
function filterFields(
  condition: unknown,
  entity: string,
  path: Path,
  targetOf: (entity: string, relation: string) => string | undefined,
): readonly { readonly entity: string; readonly name: string; readonly path: Path }[] {
  if (!isMemberRecord(condition)) return [];
  return Object.entries(condition).flatMap(([key, value]) => {
    const here = [...path, key];
    if (key === 'and' || key === 'or') {
      return Array.isArray(value)
        ? (value as unknown[]).flatMap((item, index) =>
            filterFields(item, entity, [...here, index], targetOf),
          )
        : [];
    }
    if (key === 'not') return filterFields(value, entity, here, targetOf);
    const target = relationTarget(entity, key, targetOf);
    if (target === undefined) return [{ entity, name: key, path: here }];
    return isMemberRecord(value) ? relationFields(value, target, here, targetOf) : [];
  });
}

function relationFields(
  value: Readonly<Record<string, unknown>>,
  target: string,
  path: Path,
  targetOf: (entity: string, relation: string) => string | undefined,
): readonly { readonly entity: string; readonly name: string; readonly path: Path }[] {
  return Object.entries(value).flatMap(([key, inner]) => {
    const here = [...path, key];
    if (quantifiers.has(key)) return filterFields(inner, target, here, targetOf);
    const further = relationTarget(target, key, targetOf);
    return further !== undefined && isMemberRecord(inner)
      ? relationFields(inner, further, here, targetOf)
      : [];
  });
}

/**
 * The issues for head names an older version's selections, sorts and filters use (section 18.2):
 * the name a lacking rename introduced and an added required field are not fields of the version's
 * shape, so they are refused where the input names a field outside a row.
 */
export function headNameIssues(
  registry: Registry,
  lacking: readonly VersionChangeEntry[],
  positions: EntityPositions,
  value: unknown,
): readonly ErrorIssue[] {
  const unknown = new Set<string>();
  for (const change of lacking) {
    for (const item of fieldChangesOf(change)) {
      if (item.kind !== 'removed') unknown.add(JSON.stringify([item.entity, item.field]));
    }
  }
  if (unknown.size === 0) return [];
  const lacks = (entity: string, name: string): boolean =>
    unknown.has(JSON.stringify([entity, name]));
  const targetOf = (entity: string, relation: string): string | undefined =>
    registry.entities.get(entity)?.descriptor.relations[relation]?.target;
  const issues: ErrorIssue[] = [];
  for (const position of positions.selections) {
    for (const { value: names, path } of reachAt(value, position)) {
      if (!Array.isArray(names)) continue;
      names.forEach((name: unknown, index) => {
        if (typeof name === 'string' && lacks(positions.entity, name)) {
          issues.push({ path: [...path, index], message: refusal });
        }
      });
    }
  }
  for (const position of positions.sorts) {
    for (const { value: keys, path } of reachAt(value, position)) {
      if (!Array.isArray(keys)) continue;
      keys.forEach((key: unknown, index) => {
        if (isMemberRecord(key) && typeof key.field === 'string') {
          if (lacks(positions.entity, key.field)) {
            issues.push({ path: [...path, index, 'field'], message: refusal });
          }
        }
      });
    }
  }
  for (const position of positions.filters) {
    for (const { value: filter, path } of reachAt(value, position)) {
      for (const found of filterFields(filter, positions.entity, path, targetOf)) {
        if (lacks(found.entity, found.name)) issues.push({ path: found.path, message: refusal });
      }
    }
  }
  return issues;
}
