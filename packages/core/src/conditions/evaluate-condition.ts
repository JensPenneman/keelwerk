import type { FieldKind } from '../storage/field-kind.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { compareCodePoints } from './compare-code-points.ts';
import { compareDecimals } from './compare-decimals.ts';
import type { Condition } from './condition.ts';
import type { EvaluateOptions } from './evaluate-options.ts';

function isAbsent(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function valuesEqual(a: unknown, b: unknown, kind?: FieldKind): boolean {
  if (kind === 'decimal' && typeof a === 'string' && typeof b === 'string') {
    const sign = compareDecimals(a, b);
    if (sign !== undefined) return sign === 0;
  }
  if (a === b) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) return sameBytes(a, b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'bigint' && typeof b === 'number') return Number.isInteger(b) && a === BigInt(b);
  if (typeof a === 'number' && typeof b === 'bigint') return valuesEqual(b, a);
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null &&
    a.constructor === b.constructor &&
    'equals' in a &&
    typeof a.equals === 'function'
  ) {
    return a.equals(b) === true;
  }
  return false;
}

/** Negative, zero or positive; `undefined` when the two values have no order. */
function order(a: unknown, b: unknown, kind?: FieldKind): number | undefined {
  if (kind === 'decimal' && typeof a === 'string' && typeof b === 'string') {
    const sign = compareDecimals(a, b);
    if (sign !== undefined) return sign;
  }
  if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b);
  if (
    (typeof a === 'number' || typeof a === 'bigint') &&
    (typeof b === 'number' || typeof b === 'bigint')
  ) {
    if (a < b) return -1;
    if (a > b) return 1;
    return a <= b && a >= b ? 0 : undefined;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a instanceof Temporal.Instant && b instanceof Temporal.Instant) {
    return Temporal.Instant.compare(a, b);
  }
  if (a instanceof Temporal.PlainDate && b instanceof Temporal.PlainDate) {
    return Temporal.PlainDate.compare(a, b);
  }
  return undefined;
}

function operandList(condition: Condition, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`the ${condition.op} operand must be an array`);
  }
  return value;
}

function containsElement(
  stored: unknown,
  needle: unknown,
  mapElement: (value: unknown) => unknown,
): boolean {
  if (typeof stored === 'string') return typeof needle === 'string' && stored.includes(needle);
  if (Array.isArray(stored) || stored instanceof Set) {
    for (const element of stored) if (valuesEqual(mapElement(element), needle)) return true;
  }
  return false;
}

function compare(
  condition: Extract<Condition, { readonly field: string; readonly op: string }>,
  row: StorageRow,
  options: EvaluateOptions,
): boolean {
  const { field, op } = condition;
  const raw = Object.hasOwn(row, field) ? row[field] : undefined;
  if (op === 'isNull') {
    if (typeof condition.value !== 'boolean')
      throw new TypeError('the isNull operand must be a boolean');
    return isAbsent(raw) === condition.value;
  }
  const map = options.mapValue;
  const kind = options.kindOf?.(field);
  const elementwise = op === 'contains' && (Array.isArray(raw) || raw instanceof Set);
  const stored = isAbsent(raw) || map === undefined || elementwise ? raw : map(field, raw);
  const mapOperand = (value: unknown): unknown =>
    isAbsent(value) || map === undefined ? value : map(field, value);

  if (op === 'in' || op === 'nin') {
    const list = operandList(condition, condition.value);
    if (list.some(isAbsent)) return false;
    if (isAbsent(stored)) return op === 'nin';
    const found = list.some((element) => valuesEqual(stored, mapOperand(element), kind));
    return op === 'in' ? found : !found;
  }

  const operand = mapOperand(condition.value);
  if (isAbsent(operand)) return false;
  switch (op) {
    case 'eq':
      return !isAbsent(stored) && valuesEqual(stored, operand, kind);
    case 'ne':
      return isAbsent(stored) || !valuesEqual(stored, operand, kind);
    case 'contains':
      return containsElement(stored, operand, mapOperand);
    case 'startsWith':
      return (
        typeof stored === 'string' && typeof operand === 'string' && stored.startsWith(operand)
      );
    default: {
      if (isAbsent(stored)) return false;
      const sign = order(stored, operand, kind);
      if (sign === undefined) return false;
      if (op === 'lt') return sign < 0;
      if (op === 'lte') return sign <= 0;
      if (op === 'gt') return sign > 0;
      return sign >= 0;
    }
  }
}

/**
 * Evaluates a condition against one row with the semantics of section 14.3.4: two-valued logic,
 * null-safe `ne` and `nin`, code-point string order, membership for `contains` on strings, sets
 * and lists. It is the oracle every adapter's compiled filter is compared with.
 */
export function evaluateCondition(
  condition: Condition,
  row: StorageRow,
  options: EvaluateOptions = {},
): boolean {
  switch (condition.op) {
    case 'never':
      return false;
    case 'and':
      return condition.conditions.every((inner) => evaluateCondition(inner, row, options));
    case 'or':
      return condition.conditions.some((inner) => evaluateCondition(inner, row, options));
    case 'not':
      return !evaluateCondition(condition.condition, row, options);
    case 'some':
    case 'none':
    case 'every':
    case 'is': {
      if (options.matching === undefined) {
        throw new TypeError(
          `a ${condition.op} on "${condition.relation}" needs a matching callback`,
        );
      }
      return options.matching(condition, row);
    }
    default:
      return compare(condition, row, options);
  }
}
