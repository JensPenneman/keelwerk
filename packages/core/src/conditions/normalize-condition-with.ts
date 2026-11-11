import { isPlainRecord } from '../api-versions/is-plain-record.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Condition } from './condition.ts';

type FieldOperator = Extract<Condition, { readonly field: string }>['op'];
type Quantifier = Extract<Condition, { readonly relation: string }>['op'];

function isFieldOperator(key: string): key is FieldOperator {
  switch (key) {
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
    case 'in':
    case 'nin':
    case 'contains':
    case 'startsWith':
    case 'isNull':
      return true;
    default:
      return false;
  }
}

function isQuantifier(key: string): key is Quantifier {
  return key === 'some' || key === 'none' || key === 'every' || key === 'is';
}

const maxDepth = 32;
const maxMembers = 10_000;

/** What one normalisation carries: the wire flag and the members counted so far. */
interface Run {
  readonly wire: boolean;
  members: number;
}

/** Counts `members` and refuses a level or a total over the bounds of the filter walk. */
function enter(run: Run, path: readonly string[], depth: number, members: number): void {
  if (depth > maxDepth) {
    throw malformed(path, `nests more than ${maxDepth} levels of and, or, not and relations`);
  }
  run.members += members;
  if (run.members > maxMembers) {
    throw malformed(path, `holds more than ${maxMembers} members and items`);
  }
}

const never: Condition = { op: 'never' };

function malformed(path: readonly string[], message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.malformed_request',
    message: `${path.length === 0 ? 'condition' : path.join('.')}: ${message}`,
    issues: [{ path, message }],
  });
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * A `null` or `undefined` inside an `in` or `nin` list is rejected rather than matched: a deny rule
 * must never fail open. On the wire it is a malformed request; a rule that produced it is an
 * evaluation error of the rule.
 */
function absentListEntry(op: string, path: readonly string[], wire: boolean): KeelwerkError {
  if (wire) return malformed(path, `${op} takes a list without null or undefined`);
  const message = `${path.join('.')}: ${op} takes a list without null or undefined`;
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message,
    issues: [{ path, message: `${op} takes a list without null or undefined` }],
  });
}

function operatorCondition(
  op: FieldOperator,
  field: string,
  value: unknown,
  path: readonly string[],
  run: Run,
): Condition {
  if (op === 'isNull') {
    if (typeof value !== 'boolean') throw malformed(path, 'isNull takes true or false');
    return { op: 'isNull', field, value };
  }
  if (isAbsent(value)) return never;
  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(value)) throw malformed(path, `${op} takes an array`);
    enter(run, path, 0, value.length);
    const absent = value.findIndex(isAbsent);
    if (absent >= 0) throw absentListEntry(op, [...path, String(absent)], run.wire);
    return { op, field, value: [...value] };
  }
  return { op, field, value };
}

function fieldConditions(
  field: string,
  value: unknown,
  run: Run,
  path: readonly string[],
  depth: number,
): Condition[] {
  if (value === null && run.wire) return [{ op: 'isNull', field, value: true }];
  if (isAbsent(value)) return [never];
  if (isPlainRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) throw malformed(path, 'an empty operator object');
    enter(run, path, depth, keys.length);
    const known = keys.filter(isFieldOperator);
    if (known.length === keys.length) {
      return known.map((key) => operatorCondition(key, field, value[key], [...path, key], run));
    }
    if (known.length > 0) {
      const stray = keys.find((key) => !isFieldOperator(key));
      throw malformed(path, `unknown operator "${stray}"`);
    }
    return relationConditions(field, value, run, path, depth);
  }
  return [{ op: 'eq', field, value }];
}

/**
 * A plain object without operator keys steps along a relation path: its keys extend the dotted
 * relation name until a level holds the quantifiers. Anything else under it is malformed.
 */
function relationConditions(
  relation: string,
  value: Readonly<Record<string, unknown>>,
  run: Run,
  path: readonly string[],
  depth: number,
): Condition[] {
  const keys = Object.keys(value);
  if (keys.length === 0) throw malformed(path, 'an empty relation object');
  enter(run, path, depth, 0);
  const quantifiers = keys.filter(isQuantifier);
  if (quantifiers.length === keys.length) {
    return quantifiers.map((key) =>
      relationCondition(key, relation, value[key], run, [...path, key], depth + 1),
    );
  }
  const stray = keys.find((key) => isQuantifier(key) || isFieldOperator(key));
  if (stray !== undefined) {
    throw malformed([...path, stray], `"${stray}" cannot sit beside relation names`);
  }
  return keys.flatMap((key) => {
    const inner = value[key];
    const here = [...path, key];
    if (inner === null && run.wire) throw malformed(here, 'takes a relation quantifier object');
    if (isAbsent(inner)) return [never];
    if (!isPlainRecord(inner)) throw malformed(here, 'takes a relation quantifier object');
    return relationConditions(
      `${relation}.${key}`,
      inner,
      run,
      here,
      depth + key.split('.').length,
    );
  });
}

function relationCondition(
  op: Quantifier,
  relation: string,
  value: unknown,
  run: Run,
  path: readonly string[],
  depth: number,
): Condition {
  if (isAbsent(value)) return never;
  if (!isPlainRecord(value)) throw malformed(path, `${op} takes a condition object`);
  return { op, relation, where: normalizeObject(value, run, path, depth) };
}

function listOf(
  value: unknown,
  run: Run,
  path: readonly string[],
  depth: number,
): readonly Condition[] {
  if (!Array.isArray(value)) throw malformed(path, 'takes an array of conditions');
  enter(run, path, depth, value.length);
  return value.map((entry: unknown, index) => {
    const here = [...path, String(index)];
    if (!isPlainRecord(entry)) throw malformed(here, 'takes a condition object');
    return normalizeObject(entry, run, here, depth + 1);
  });
}

function normalizeObject(
  input: Readonly<Record<string, unknown>>,
  run: Run,
  path: readonly string[],
  depth: number,
): Condition {
  const keys = Object.keys(input);
  enter(run, path, depth, keys.length);
  const parts: Condition[] = [];
  for (const key of keys) {
    const value = input[key];
    const here = [...path, key];
    if (key === 'and' || key === 'or') {
      if (value !== undefined) parts.push({ op: key, conditions: listOf(value, run, here, depth) });
    } else if (key === 'not') {
      if (value !== undefined) {
        if (!isPlainRecord(value)) throw malformed(here, 'takes a condition object');
        parts.push({ op: 'not', condition: normalizeObject(value, run, here, depth + 1) });
      }
    } else {
      parts.push(...fieldConditions(key, value, run, here, depth + key.split('.').length - 1));
    }
  }
  const [only] = parts;
  return parts.length === 1 && only !== undefined ? only : { op: 'and', conditions: parts };
}

/**
 * Normalises the object form of section 8.3 to the AST. `wire` makes a bare `null` mean absent
 * (section 16.4.4); in code it is a comparison that matches nothing. Nesting deeper than 32 levels
 * of `and`, `or`, `not`, quantifiers and relation steps, or more than 10 000 members and items in
 * all, is refused with `core.malformed_request` like the filter walk does, so the bound holds for
 * a caller that did not pass through the walk.
 */
export function normalizeConditionWith(input: unknown, wire: boolean): Condition {
  if (!isPlainRecord(input)) throw malformed([], 'takes a condition object');
  return normalizeObject(input, { wire, members: 0 }, [], 0);
}
