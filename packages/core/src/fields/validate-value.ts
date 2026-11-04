import { parseTypeId } from '../ids/parse-type-id.ts';
import { decodeBase64Url } from './decode-base64-url.ts';
import type { AbsoluteRef, AnyField, OwnRef } from './field-def.ts';
import type { StandardIssue, StandardResult } from './standard-schema-v1.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rfc3339Instant = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const decimalText = /^(-?)(\d+)(?:\.(\d+))?$/;
const integerText = /^-?\d+$/;
const emailText = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hostnameLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const int64Min = -(2n ** 63n);
const int64Max = 2n ** 63n - 1n;

type Outcome = StandardResult<unknown>;

function fail(message: string): Outcome {
  return { issues: [{ message }] };
}

function ok(value: unknown): Outcome {
  return { value };
}

function option(options: unknown, key: string): unknown {
  return typeof options === 'object' && options !== null && !Array.isArray(options)
    ? (Reflect.get(options, key) as unknown)
    : undefined;
}

function numberOption(options: unknown, key: string): number | undefined {
  const value = option(options, key);
  return typeof value === 'number' ? value : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function belowBound(value: bigint, bound: number): boolean {
  return Number.isInteger(bound) ? value < BigInt(bound) : Number(value) < bound;
}

function aboveBound(value: bigint, bound: number): boolean {
  return Number.isInteger(bound) ? value > BigInt(bound) : Number(value) > bound;
}

function hostnameOk(value: string): boolean {
  return value.length <= 253 && value.split('.').every((label) => hostnameLabel.test(label));
}

function formatOk(format: unknown, value: string): boolean {
  if (format === 'email') {
    return value.length <= 254 && emailText.test(value);
  }
  if (format === 'uri') {
    return URL.canParse(value);
  }
  return format === 'hostname' ? hostnameOk(value) : true;
}

function validateText(options: unknown, value: unknown): Outcome {
  if (typeof value !== 'string') {
    return fail('expected a string');
  }
  const length = [...value].length;
  const maxLength = numberOption(options, 'maxLength');
  const minLength = numberOption(options, 'minLength');
  const pattern = option(options, 'pattern');
  if (maxLength !== undefined && length > maxLength) {
    return fail(`must be at most ${maxLength} characters`);
  }
  if (minLength !== undefined && length < minLength) {
    return fail(`must be at least ${minLength} characters`);
  }
  if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
    return fail(`must match the pattern ${pattern}`);
  }
  return formatOk(option(options, 'format'), value) ? ok(value) : fail('has the wrong format');
}

function validateWide(options: unknown, value: unknown): Outcome {
  const big =
    typeof value === 'bigint'
      ? value
      : typeof value === 'string' && integerText.test(value)
        ? BigInt(value)
        : undefined;
  if (big === undefined) {
    return fail('expected a bigint or a decimal string');
  }
  const min = numberOption(options, 'min');
  const max = numberOption(options, 'max');
  if (big < int64Min || big > int64Max) {
    return fail('is outside the 64-bit range');
  }
  if ((min !== undefined && belowBound(big, min)) || (max !== undefined && aboveBound(big, max))) {
    return fail('is outside the allowed range');
  }
  return ok(big);
}

function validateInteger(options: unknown, value: unknown): Outcome {
  if (option(options, 'wide') === true) {
    return validateWide(options, value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return fail('expected a safe integer');
  }
  const min = numberOption(options, 'min');
  const max = numberOption(options, 'max');
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    return fail('is outside the allowed range');
  }
  return ok(value);
}

function validateDecimal(options: unknown, value: unknown): Outcome {
  const match = typeof value === 'string' ? decimalText.exec(value) : null;
  if (match === null) {
    return fail('expected a decimal string');
  }
  const precision = numberOption(options, 'precision') ?? Number.POSITIVE_INFINITY;
  const scale = numberOption(options, 'scale') ?? 0;
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = match[3] ?? '';
  if (fraction.length > scale) {
    return fail(`has more than ${scale} decimal places`);
  }
  if ((whole === '0' ? 0 : whole.length) > precision - scale) {
    return fail(`has more than ${precision - scale} integer digits`);
  }
  const padded = fraction.padEnd(scale, '0');
  const zero = /^0*$/.test(whole + padded);
  const text = scale > 0 ? `${whole}.${padded}` : whole;
  return ok(zero || match[1] === '' ? text : `-${text}`);
}

function validateInstant(value: unknown): Outcome {
  try {
    const instant =
      value instanceof Temporal.Instant
        ? value
        : typeof value === 'string' && rfc3339Instant.test(value)
          ? Temporal.Instant.from(value)
          : undefined;
    if (instant === undefined) {
      return fail('expected an RFC 3339 instant');
    }
    return ok(instant.round({ smallestUnit: 'millisecond', roundingMode: 'floor' }));
  } catch {
    return fail('is not a valid instant');
  }
}

function validateDate(value: unknown): Outcome {
  if (value instanceof Temporal.PlainDate) {
    return value.calendarId === 'iso8601' ? ok(value) : fail('expected an ISO calendar date');
  }
  if (typeof value !== 'string' || !isoDate.test(value)) {
    return fail('expected an ISO calendar date');
  }
  try {
    return ok(Temporal.PlainDate.from(value, { overflow: 'reject' }));
  } catch {
    return fail('is not a valid calendar date');
  }
}

function validateTimeZone(value: unknown): Outcome {
  if (typeof value !== 'string' || value === '' || /^[+-]\d/.test(value)) {
    return fail('expected an IANA time zone name');
  }
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions()
      .timeZone;
    return ok(resolved.toLowerCase() === value.toLowerCase() ? resolved : value);
  } catch {
    return fail('is not a known time zone');
  }
}

function validateBinary(value: unknown): Outcome {
  if (value instanceof Uint8Array) {
    return ok(value);
  }
  const bytes = typeof value === 'string' ? decodeBase64Url(value) : undefined;
  return bytes === undefined ? fail('expected bytes or a base64url string') : ok(bytes);
}

function validateId(
  ref: AbsoluteRef | OwnRef | null,
  value: unknown,
  prefixOf: ValidateOptions['prefixOf'],
): Outcome {
  if (typeof value !== 'string') {
    return fail('expected an id');
  }
  if (uuidPattern.test(value)) {
    return ok(value.toLowerCase());
  }
  const prefix = ref === null ? undefined : prefixOf?.(ref);
  const parsed = prefix === undefined ? undefined : parseTypeId(value, prefix);
  return parsed === undefined ? fail('is not a well-formed id') : ok(parsed);
}

function withPath(issues: readonly StandardIssue[], key: PropertyKey): StandardIssue[] {
  return issues.map((issue) => ({ ...issue, path: [key, ...(issue.path ?? [])] }));
}

function validateJson(schema: unknown, value: unknown): Outcome {
  const standard = isObject(schema) ? Reflect.get(schema, '~standard') : undefined;
  const validate: unknown = isObject(standard) ? Reflect.get(standard, 'validate') : undefined;
  if (typeof validate !== 'function') {
    return fail('the field has no schema');
  }
  const result = validate.call(standard, value) as Outcome | Promise<Outcome>;
  return result instanceof Promise ? fail('asynchronous schemas are not supported') : result;
}

function validateMany(field: AnyField, value: unknown, options: ValidateOptions): Outcome {
  const items = field.kind === 'set' && value instanceof Set ? [...value] : value;
  if (!Array.isArray(items) || field.inner === null) {
    return fail(field.kind === 'set' ? 'expected a set or an array' : 'expected an array');
  }
  const values: unknown[] = [];
  const issues: StandardIssue[] = [];
  for (const [index, item] of items.entries()) {
    const result = validateValue(field.inner, item, options);
    if (result.issues === undefined) {
      values.push(result.value);
    } else {
      issues.push(...withPath(result.issues, index));
    }
  }
  if (issues.length > 0) {
    return { issues };
  }
  return ok(field.kind === 'set' ? new Set(values) : values);
}

function validateKind(field: AnyField, value: unknown, options: ValidateOptions): Outcome {
  const text = (accept: boolean, expected: string): Outcome =>
    accept ? ok(value) : fail(expected);
  switch (field.kind) {
    case 'string':
    case 'text':
      return validateText(field.options, value);
    case 'integer':
      return validateInteger(field.options, value);
    case 'decimal':
      return validateDecimal(field.options, value);
    case 'float':
      return text(typeof value === 'number' && Number.isFinite(value), 'expected a finite number');
    case 'boolean':
      return text(typeof value === 'boolean', 'expected a boolean');
    case 'instant':
      return validateInstant(value);
    case 'date':
      return validateDate(value);
    case 'timeZone':
      return validateTimeZone(value);
    case 'enum':
      return text(
        Array.isArray(field.options) && field.options.includes(value),
        `expected one of ${JSON.stringify(field.options)}`,
      );
    case 'json':
      return validateJson(field.options, value);
    case 'ref':
      return validateId(field.ref, value, options.prefixOf);
    case 'subject':
    case 'verifier':
      return text(typeof value === 'string' && value !== '', 'expected a non-empty string');
    case 'serial':
      return text(
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
        'expected a non-negative safe integer',
      );
    case 'set':
    case 'list':
      return validateMany(field, value, options);
    case 'richText':
      return text(isObject(value), 'expected a document handle');
    case 'binary':
      return validateBinary(value);
    case 'blob':
      return text(typeof option(value, 'key') === 'string', 'expected a blob reference');
    case 'secret':
      return text(
        (typeof value === 'string' && value !== '') || typeof option(value, 'ref') === 'string',
        'expected a secret',
      );
    default: {
      const unknownKind: never = field.kind;
      return fail(`has an unknown field kind ${String(unknownKind)}`);
    }
  }
}

/** Options of `validateValue`. */
interface ValidateOptions {
  /** The TypeID prefix of the entity a reference points at; without it, references are read as UUIDs. */
  readonly prefixOf?: ((ref: AbsoluteRef | OwnRef) => string | undefined) | undefined;
}

/**
 * Validates one value against a field. The value may be in wire form (an RFC 3339 string, a
 * decimal string, a base64url string) or in-process form (a `Temporal.Instant`, a `bigint`,
 * bytes); the result is always in-process form, with instants rounded down to milliseconds.
 * An absent value yields the default, or `undefined` for an optional field (section 6.5).
 */
export function validateValue(
  field: AnyField,
  value: unknown,
  options: ValidateOptions = {},
): StandardResult<unknown> {
  if (value === undefined) {
    if (field.flags.defaulted) {
      return validateKind(field, field.defaultValue, options);
    }
    return field.flags.optional ? ok(undefined) : fail('is required');
  }
  return validateKind(field, value, options);
}

export type { ValidateOptions };
