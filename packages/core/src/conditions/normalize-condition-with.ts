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

const never: Condition = { op: 'never' };

function malformed(path: readonly string[], message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.malformed_request',
    message: `${path.length === 0 ? 'condition' : path.join('.')}: ${message}`,
    issues: [{ path, message }],
  });
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
  wire: boolean,
): Condition {
  if (op === 'isNull') {
    if (typeof value !== 'boolean') throw malformed(path, 'isNull takes true or false');
    return { op: 'isNull', field, value };
  }
  if (isAbsent(value)) return never;
  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(value)) throw malformed(path, `${op} takes an array`);
    if (value.some(isAbsent)) throw absentListEntry(op, path, wire);
    return { op, field, value: [...value] };
  }
  return { op, field, value };
}

function fieldConditions(
  field: string,
  value: unknown,
  wire: boolean,
  path: readonly string[],
): Condition[] {
  if (value === null && wire) return [{ op: 'isNull', field, value: true }];
  if (isAbsent(value)) return [never];
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) throw malformed(path, 'an empty operator object');
    const known = keys.filter(isFieldOperator);
    if (known.length === keys.length) {
      return known.map((key) => operatorCondition(key, field, value[key], [...path, key], wire));
    }
    if (known.length > 0) {
      const stray = keys.find((key) => !isFieldOperator(key));
      throw malformed(path, `unknown operator "${stray}"`);
    }
    return relationConditions(field, value, wire, path);
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
  wire: boolean,
  path: readonly string[],
): Condition[] {
  const keys = Object.keys(value);
  if (keys.length === 0) throw malformed(path, 'an empty relation object');
  const quantifiers = keys.filter(isQuantifier);
  if (quantifiers.length === keys.length) {
    return quantifiers.map((key) =>
      relationCondition(key, relation, value[key], wire, [...path, key]),
    );
  }
  const stray = keys.find((key) => isQuantifier(key) || isFieldOperator(key));
  if (stray !== undefined) {
    throw malformed([...path, stray], `"${stray}" cannot sit beside relation names`);
  }
  return keys.flatMap((key) => {
    const inner = value[key];
    const here = [...path, key];
    if (inner === null && wire) throw malformed(here, 'takes a relation quantifier object');
    if (isAbsent(inner)) return [never];
    if (!isPlainObject(inner)) throw malformed(here, 'takes a relation quantifier object');
    return relationConditions(`${relation}.${key}`, inner, wire, here);
  });
}

function relationCondition(
  op: Quantifier,
  relation: string,
  value: unknown,
  wire: boolean,
  path: readonly string[],
): Condition {
  if (isAbsent(value)) return never;
  if (!isPlainObject(value)) throw malformed(path, `${op} takes a condition object`);
  return { op, relation, where: normalizeObject(value, wire, path) };
}

function listOf(value: unknown, wire: boolean, path: readonly string[]): readonly Condition[] {
  if (!Array.isArray(value)) throw malformed(path, 'takes an array of conditions');
  return value.map((entry: unknown, index) => {
    const here = [...path, String(index)];
    if (!isPlainObject(entry)) throw malformed(here, 'takes a condition object');
    return normalizeObject(entry, wire, here);
  });
}

function normalizeObject(
  input: Readonly<Record<string, unknown>>,
  wire: boolean,
  path: readonly string[],
): Condition {
  const parts: Condition[] = [];
  for (const key of Object.keys(input)) {
    const value = input[key];
    const here = [...path, key];
    if (key === 'and' || key === 'or') {
      if (value !== undefined) parts.push({ op: key, conditions: listOf(value, wire, here) });
    } else if (key === 'not') {
      if (value !== undefined) {
        if (!isPlainObject(value)) throw malformed(here, 'takes a condition object');
        parts.push({ op: 'not', condition: normalizeObject(value, wire, here) });
      }
    } else {
      parts.push(...fieldConditions(key, value, wire, here));
    }
  }
  const [only] = parts;
  return parts.length === 1 && only !== undefined ? only : { op: 'and', conditions: parts };
}

/**
 * Normalises the object form of section 8.3 to the AST. `wire` makes a bare `null` mean absent
 * (section 16.4.4); in code it is a comparison that matches nothing.
 */
export function normalizeConditionWith(input: unknown, wire: boolean): Condition {
  if (!isPlainObject(input)) throw malformed([], 'takes a condition object');
  return normalizeObject(input, wire, []);
}
