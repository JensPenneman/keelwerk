import type { ErrorIssue } from '../errors/error-issue.ts';
import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { mapFilter } from '../wire/map-filter.ts';
import type { EntityPositions } from './entity-positions.ts';
import { fieldChangesOf } from './field-changes-of.ts';
import { isMemberRecord } from './is-member-record.ts';
import { reachAt } from './reach-at.ts';
import { refuseFilterLimit } from './refuse-filter-limit.ts';

const refusal = 'is not a field of this shape';

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
      refuseFilterLimit(() =>
        mapFilter(
          filter,
          positions.entity,
          targetOf,
          (field) => {
            if (lacks(field.entity, field.key)) issues.push({ path: field.path, message: refusal });
            return { name: field.key, value: field.value };
          },
          path,
        ),
      );
    }
  }
  return issues;
}
