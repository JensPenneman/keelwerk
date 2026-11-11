import { mapFilter } from '../wire/map-filter.ts';
import { refuseFilterLimit } from './refuse-filter-limit.ts';

type TargetOf = (entity: string, relation: string) => string | undefined;
type RenameOf = (entity: string, field: string) => string;

/**
 * Renames the field keys of a filter of `entity` in the object form of section 16.4.4 (the walk
 * of `mapFilter`: `and`, `or` and `not` recurse, and the value of a relation recurses with the
 * entity the path ends on). Operators and values are never renamed. An unchanged condition is
 * returned as it is.
 */
export function renameCondition(
  condition: unknown,
  entity: string,
  renameOf: RenameOf,
  targetOf: TargetOf,
): unknown {
  return refuseFilterLimit(() =>
    mapFilter(condition, entity, targetOf, (field) => ({
      name: renameOf(field.entity, field.key),
      value: field.value,
    })),
  );
}
