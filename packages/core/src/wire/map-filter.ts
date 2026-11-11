import { isMemberRecord } from '../api-versions/is-member-record.ts';
import { isPlainRecord } from '../api-versions/is-plain-record.ts';
import { relationTarget } from '../api-versions/relation-target.ts';
import { FilterLimitError } from './filter-limit-error.ts';

type Path = readonly (string | number)[];
type TargetOf = (entity: string, relation: string) => string | undefined;

interface Walk {
  readonly targetOf: TargetOf;
  readonly onField: (field: FilterField) => FilterFieldEdit;
  members: number;
}

const quantifiers: ReadonlySet<string> = new Set(['some', 'none', 'every', 'is']);
const maxDepth = 32;
const maxMembers = 10_000;

function enter(walk: Walk, path: Path, depth: number, members: number): void {
  if (depth > maxDepth) {
    throw new FilterLimitError(
      path,
      `nests more than ${maxDepth} levels of and, or, not and relations`,
    );
  }
  walk.members += members;
  if (walk.members > maxMembers) {
    throw new FilterLimitError(path, `holds more than ${maxMembers} members and items`);
  }
}

/** The relation steps of a key: a dotted path is one level for each of its segments. */
function steps(key: string): number {
  return key.split('.').length;
}

/**
 * Measures the nesting of a value the walk does not rewrite (an operand, or a record under a key
 * that is neither a relation nor a quantifier, which the normaliser steps into as a dotted
 * relation path) with an explicit stack: objects and arrays nested deeper than the bound, counted
 * from `depth`, are refused like the walked levels, before anything recurses into them.
 */
function bound(path: Path, value: unknown, depth: number): void {
  const stack: [unknown, number][] = [[value, depth]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [node, level] = top;
    if (typeof node !== 'object' || node === null) continue;
    if (!Array.isArray(node) && !isPlainRecord(node)) continue;
    if (level > maxDepth) {
      throw new FilterLimitError(
        path,
        `nests objects and arrays more than ${maxDepth} levels deep`,
      );
    }
    for (const child of Array.isArray(node) ? (node as unknown[]) : Object.values(node)) {
      stack.push([child, level + 1]);
    }
  }
}

/**
 * The value of a relation key: its quantifiers recurse with the entity the path ends on, and a
 * key that is not a quantifier extends the path (a nested relation object, section 16.4.4) and
 * steps on. An unchanged value is returned as it is.
 */
function mapRelationValue(
  walk: Walk,
  value: Readonly<Record<string, unknown>>,
  target: string,
  path: Path,
  depth: number,
): Readonly<Record<string, unknown>> {
  const entries = Object.entries(value);
  enter(walk, path, depth, entries.length);
  let changed = false;
  const out: [string, unknown][] = [];
  for (const [key, inner] of entries) {
    let next = inner;
    if (quantifiers.has(key)) {
      next = mapCondition(walk, inner, target, [...path, key], depth + 1);
    } else if (isMemberRecord(inner)) {
      const further = relationTarget(target, key, walk.targetOf);
      if (further !== undefined) {
        const level = depth + steps(key);
        enter(walk, [...path, key], level, 0);
        next = mapRelationValue(walk, inner, further, [...path, key], level);
      } else {
        bound([...path, key], inner, depth + 1);
      }
    } else {
      bound([...path, key], inner, depth + 1);
    }
    if (next !== inner) changed = true;
    out.push([key, next]);
  }
  return changed ? Object.fromEntries(out) : value;
}

function mapCondition(
  walk: Walk,
  condition: unknown,
  entity: string,
  path: Path,
  depth: number,
): unknown {
  if (!isMemberRecord(condition)) {
    bound(path, condition, depth);
    return condition;
  }
  const entries = Object.entries(condition);
  enter(walk, path, depth, entries.length);
  let changed = false;
  const out: [string, unknown][] = [];
  for (const [key, value] of entries) {
    const here = [...path, key];
    let name = key;
    let next = value;
    if (key === 'and' || key === 'or') {
      if (Array.isArray(value)) {
        enter(walk, here, depth, value.length);
        const items = (value as unknown[]).map((item, index) =>
          mapCondition(walk, item, entity, [...here, index], depth + 1),
        );
        if (items.some((item, index) => item !== value[index])) next = items;
      } else {
        bound(here, value, depth + 1);
      }
    } else if (key === 'not') {
      next = mapCondition(walk, value, entity, here, depth + 1);
    } else {
      const target = relationTarget(entity, key, walk.targetOf);
      if (target === undefined) {
        bound(here, value, depth + 1);
        const edit = walk.onField({ entity, key, value, path: here });
        name = edit.name;
        next = edit.value;
      } else {
        const level = depth + steps(key);
        enter(walk, here, level, 0);
        if (isMemberRecord(value)) {
          next = mapRelationValue(walk, value, target, here, level);
        } else {
          bound(here, value, level);
        }
      }
    }
    if (name !== key || next !== value) changed = true;
    out.push([name, next]);
  }
  // Every member is an own data property: a key `__proto__` from JSON.parse stays a key.
  return changed ? Object.fromEntries(out) : condition;
}

/** A field key of a filter, with the entity it belongs to and the path to its key. */
export interface FilterField {
  readonly entity: string;
  readonly key: string;
  readonly value: unknown;
  readonly path: Path;
}

/** What a visit of a field answers: its name and operand, as they are or replaced. */
export interface FilterFieldEdit {
  readonly name: string;
  readonly value: unknown;
}

/**
 * The one walk over the filter grammar of section 16.4.4 in the object form: `and`, `or` and `not`
 * recurse, and the value of a relation (a name, a dotted path or nested relation objects, ending
 * on a quantifier `some`, `none`, `every` or `is`) recurses with the entity the path ends on
 * (`targetOf`; a key that is a relation is a relation, otherwise a field). `onField` is asked for
 * every field key with the entity it belongs to and its operand, and answers the name and operand
 * to keep; operators and relations are never offered. An unchanged filter is returned as it is,
 * a changed level is rebuilt with every member as an own property.
 *
 * Nesting deeper than 32 levels of `and`, `or`, `not`, quantifiers and relation steps (and of the
 * objects and arrays of an operand or of a key the walk does not rewrite), or more
 * than 10 000 members and `and`/`or` items in all, is refused with a `FilterLimitError` (the server side
 * answers `core.malformed_request`, `refuseFilterLimit`) carrying the path of the level that went over,
 * before the walk recurses further. `path` is where the
 * filter sits in its input; paths of the answer and of the refusal start with it.
 */
export function mapFilter(
  filter: unknown,
  entity: string,
  targetOf: TargetOf,
  onField: (field: FilterField) => FilterFieldEdit,
  path: Path = [],
): unknown {
  return mapCondition({ targetOf, onField, members: 0 }, filter, entity, path, 0);
}
