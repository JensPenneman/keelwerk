import { isMemberRecord } from './is-member-record.ts';
import { relationTarget } from './relation-target.ts';

const quantifiers: ReadonlySet<string> = new Set(['some', 'none', 'every', 'is']);

type TargetOf = (entity: string, relation: string) => string | undefined;
type RenameOf = (entity: string, field: string) => string;

/**
 * The value of a relation key: its quantifiers recurse with the entity the path ends on, and a
 * key that is not a quantifier extends the path (a nested relation object, section 16.4.4) and
 * steps on. An unchanged value is returned as it is.
 */
function renameRelationValue(
  value: Readonly<Record<string, unknown>>,
  target: string,
  renameOf: RenameOf,
  targetOf: TargetOf,
): Readonly<Record<string, unknown>> {
  let changed = false;
  const renamed: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    let next = inner;
    if (quantifiers.has(key)) {
      next = renameCondition(inner, target, renameOf, targetOf);
    } else if (isMemberRecord(inner)) {
      const further = relationTarget(target, key, targetOf);
      if (further !== undefined) next = renameRelationValue(inner, further, renameOf, targetOf);
    }
    if (next !== inner) changed = true;
    renamed[key] = next;
  }
  return changed ? renamed : value;
}

/**
 * Renames the field keys of a filter of `entity` in the object form of section 16.4.4: `and`, `or`
 * and `not` recurse, and the value of a relation (a name, a dotted path or nested relation
 * objects, ending on a quantifier `some`, `none`, `every` or `is`) recurses with the entity the
 * path ends on. Operators and values are never renamed. An unchanged condition is returned as it is.
 */
export function renameCondition(
  condition: unknown,
  entity: string,
  renameOf: RenameOf,
  targetOf: TargetOf,
): unknown {
  if (!isMemberRecord(condition)) return condition;
  let changed = false;
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(condition)) {
    let name = key;
    let next = value;
    if (key === 'and' || key === 'or') {
      if (Array.isArray(value)) {
        const items = value.map((item: unknown) =>
          renameCondition(item, entity, renameOf, targetOf),
        );
        if (items.some((item, index) => item !== value[index])) next = items;
      }
    } else if (key === 'not') {
      next = renameCondition(value, entity, renameOf, targetOf);
    } else {
      const target = relationTarget(entity, key, targetOf);
      if (target === undefined) {
        name = renameOf(entity, key);
      } else if (isMemberRecord(value)) {
        next = renameRelationValue(value, target, renameOf, targetOf);
      }
    }
    if (name !== key || next !== value) changed = true;
    renamed[name] = next;
  }
  return changed ? renamed : condition;
}
