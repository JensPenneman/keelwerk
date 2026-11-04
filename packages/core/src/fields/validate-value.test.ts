import { describe, expect, test } from 'vitest';
import { renderTypeId } from '../ids/render-type-id.ts';
import { field } from './field.ts';
import type { AnyField } from './field-def.ts';
import { shape } from './shape.ts';
import { validateValue } from './validate-value.ts';

function accepts(candidate: AnyField, value: unknown): unknown {
  const result = validateValue(candidate, value);
  expect(result.issues).toBeUndefined();
  return 'value' in result ? result.value : undefined;
}

function rejects(candidate: AnyField, value: unknown): void {
  expect(validateValue(candidate, value).issues).toBeDefined();
}

describe('robustness', () => {
  test('a default is normalised like any value', () => {
    const at = field.instant().default(Temporal.Instant.from('2026-01-01T00:00:00.123456Z'));
    expect(accepts(at, undefined)).toEqual(Temporal.Instant.from('2026-01-01T00:00:00.123Z'));
    const price = field.decimal({ precision: 6, scale: 2 }).default('1.5');
    expect(accepts(price, undefined)).toBe('1.50');
  });

  test('a secret validates to the plain string', () => {
    const result = shape({ k: field.secret() })['~standard'].validate({ k: 'plain' });
    expect(result).toEqual({ value: { k: 'plain' } });
  });

  test('an absent field named like an inherited member is absent', () => {
    const result = shape({ constructor: field.string().optional() })['~standard'].validate({});
    expect(result).toEqual({ value: {} });
  });

  test('an invalid pattern fails when the field is defined', () => {
    expect(() => field.string({ pattern: '(' })).toThrow(SyntaxError);
  });

  test('base64url text with non-zero trailing bits is rejected', () => {
    expect(accepts(field.binary(), 'QQ')).toEqual(Uint8Array.from([65]));
    rejects(field.binary(), 'QR');
    rejects(field.binary(), 'QUF');
  });
});

describe('strings', () => {
  test('lengths count characters and patterns and formats apply', () => {
    const name = field.string({ minLength: 2, maxLength: 3, pattern: '^[a-z😀]+$' });
    expect(accepts(name, 'ab')).toBe('ab');
    expect(accepts(name, 'a😀b')).toBe('a😀b');
    rejects(name, 'a');
    rejects(name, 'abcd');
    rejects(name, 'AB');
    rejects(name, 5);
    expect(accepts(field.string({ format: 'email' }), 'jens@example.com')).toBe('jens@example.com');
    rejects(field.string({ format: 'email' }), 'jens');
    expect(accepts(field.string({ format: 'uri' }), 'https://example.com/a')).toBeDefined();
    rejects(field.string({ format: 'uri' }), 'not a uri');
    expect(accepts(field.string({ format: 'hostname' }), 'mail.example.com')).toBeDefined();
    rejects(field.string({ format: 'hostname' }), '-bad-.example.com');
    expect(accepts(field.text(), 'x'.repeat(5000))).toHaveLength(5000);
  });
});

describe('numbers', () => {
  test('integers are safe integers within their bounds', () => {
    const count = field.integer({ min: 0, max: 10 });
    expect(accepts(count, 5)).toBe(5);
    rejects(count, 11);
    rejects(count, -1);
    rejects(count, 1.5);
    rejects(count, Number.MAX_SAFE_INTEGER + 1);
    rejects(count, '5');
    rejects(field.integer(), Number.NaN);
    expect(accepts(field.integer(), Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
  });

  test('wide integers take a decimal string or a bigint and give a bigint', () => {
    const wide = field.integer({ wide: true });
    expect(accepts(wide, '9223372036854775807')).toBe(9223372036854775807n);
    expect(accepts(wide, -5n)).toBe(-5n);
    rejects(wide, '9223372036854775808');
    rejects(wide, 5);
    rejects(wide, '1.5');
    rejects(field.integer({ wide: true, min: 0 }), '-1');
  });

  test('decimals are canonical exact strings', () => {
    const price = field.decimal({ precision: 6, scale: 2 });
    expect(accepts(price, '12.5')).toBe('12.50');
    expect(accepts(price, '007')).toBe('7.00');
    expect(accepts(price, '-0.00')).toBe('0.00');
    expect(accepts(price, '-1.05')).toBe('-1.05');
    rejects(price, '1.234');
    rejects(price, '12345.00');
    rejects(price, 1.5);
    rejects(price, '1e3');
    expect(accepts(field.decimal({ precision: 3, scale: 0 }), '123')).toBe('123');
  });

  test('floats are finite numbers', () => {
    expect(accepts(field.float(), 1.5)).toBe(1.5);
    rejects(field.float(), Number.POSITIVE_INFINITY);
    rejects(field.float(), '1.5');
  });
});

describe('time', () => {
  test('instants accept RFC 3339 strings and Temporal.Instant, rounded down to milliseconds', () => {
    const at = field.instant();
    const parsed = accepts(at, '2026-11-04T10:00:00.123456789Z');
    expect(parsed).toBeInstanceOf(Temporal.Instant);
    expect(String(parsed)).toBe('2026-11-04T10:00:00.123Z');
    expect(String(accepts(at, '2026-11-04T12:00:00+02:00'))).toBe('2026-11-04T10:00:00Z');
    const instant = Temporal.Instant.from('2026-11-04T10:00:00.999999999Z');
    expect(String(accepts(at, instant))).toBe('2026-11-04T10:00:00.999Z');
    expect(String(accepts(at, '1969-12-31T23:59:59.9999Z'))).toBe('1969-12-31T23:59:59.999Z');
    rejects(at, '2026-11-04T10:00:00');
    rejects(at, '2026-11-04');
    rejects(at, '2026-13-04T10:00:00Z');
    rejects(at, 1_700_000_000_000);
    rejects(at, new Date());
  });

  test('dates and time zones', () => {
    const day = field.date();
    expect(String(accepts(day, '2026-11-04'))).toBe('2026-11-04');
    expect(String(accepts(day, Temporal.PlainDate.from('2026-11-04')))).toBe('2026-11-04');
    rejects(day, '2026-02-30');
    rejects(day, '2026-11-04T10:00:00Z');
    expect(accepts(field.timeZone(), 'Europe/Brussels')).toBe('Europe/Brussels');
    expect(accepts(field.timeZone(), 'europe/brussels')).toBe('Europe/Brussels');
    rejects(field.timeZone(), 'Mars/Olympus');
    rejects(field.timeZone(), '+02:00');
    rejects(field.timeZone(), '');
  });
});

describe('other kinds', () => {
  test('booleans, enums, subjects, serials, verifiers', () => {
    expect(accepts(field.boolean(), false)).toBe(false);
    rejects(field.boolean(), 0);
    expect(accepts(field.enum(['a', 'b']), 'b')).toBe('b');
    rejects(field.enum(['a', 'b']), 'c');
    expect(accepts(field.subject(), 'sub_1')).toBe('sub_1');
    rejects(field.subject(), '');
    expect(accepts(field.serial(), 7)).toBe(7);
    rejects(field.serial(), -1);
    rejects(field.verifier(), '');
  });

  test('binary takes bytes or base64url', () => {
    const raw = field.binary();
    expect(accepts(raw, 'AQID_-A')).toEqual(Uint8Array.of(1, 2, 3, 255, 224));
    expect(accepts(raw, '')).toEqual(new Uint8Array());
    const bytes = Uint8Array.of(9);
    expect(accepts(raw, bytes)).toBe(bytes);
    rejects(raw, 'a+b/');
    rejects(raw, 'A');
    rejects(raw, 5);
  });

  test('references read UUIDs, or TypeIDs when the prefix is known', () => {
    const owner = field.ref.own('profile');
    const uuid = '0188bcae-6bb8-7e30-8f72-d6d8a2d34a3b';
    expect(accepts(owner, uuid)).toBe(uuid);
    expect(accepts(owner, uuid.toUpperCase())).toBe(uuid);
    rejects(owner, renderTypeId('prof', uuid));
    const typed = validateValue(owner, renderTypeId('prof', uuid), { prefixOf: () => 'prof' });
    expect('value' in typed ? typed.value : undefined).toBe(uuid);
    expect(
      validateValue(owner, renderTypeId('cred', uuid), { prefixOf: () => 'prof' }).issues,
    ).toBeDefined();
    rejects(owner, 'nope');
  });

  test('json runs the schema, set and list validate their elements', () => {
    const lines = field.list(field.json(shape({ qty: field.integer() })));
    expect(accepts(lines, [{ qty: 1 }])).toEqual([{ qty: 1 }]);
    const bad = validateValue(lines, [{ qty: 1 }, { qty: 'x' }]);
    expect(bad.issues?.[0]?.path).toEqual([1, 'qty']);
    const tags = field.set(field.string());
    const set = accepts(tags, ['a', 'b', 'a']);
    expect(set).toEqual(new Set(['a', 'b']));
    expect(accepts(tags, new Set(['a']))).toEqual(new Set(['a']));
    rejects(tags, 'a');
    rejects(field.list(field.string()), new Set(['a']));
  });

  test('blobs, secrets and rich text pass opaque values', () => {
    expect(accepts(field.blob({}), { key: 'k1' })).toEqual({ key: 'k1' });
    rejects(field.blob({}), 'k1');
    expect(accepts(field.secret(), 'hunter2')).toBe('hunter2');
    expect(accepts(field.secret(), { ref: 'sec_1' })).toEqual({ ref: 'sec_1' });
    rejects(field.secret(), '');
    rejects(field.richText(), 'text');
  });
});

describe('absent values and shapes', () => {
  test('required, optional and defaulted fields', () => {
    rejects(field.string(), undefined);
    rejects(field.string(), null);
    expect(accepts(field.string().optional(), undefined)).toBeUndefined();
    expect(accepts(field.string().default('nl-BE'), undefined)).toBe('nl-BE');
    expect(accepts(field.string().default('nl-BE'), 'fr-BE')).toBe('fr-BE');
    rejects(field.string().optional(), null);
  });

  test('a shape is a Standard Schema that fills defaults and rejects unknown names', () => {
    const input = shape({
      name: field.string({ maxLength: 5 }),
      at: field.instant(),
      locale: field.string().default('nl-BE'),
      note: field.string().optional(),
    });
    expect(input['~standard'].vendor).toBe('keelwerk');
    const good = input['~standard'].validate({ name: 'abc', at: '2026-11-04T10:00:00.5Z' });
    expect(good).toEqual({
      value: { name: 'abc', at: Temporal.Instant.from('2026-11-04T10:00:00.5Z'), locale: 'nl-BE' },
    });
    const bad = input['~standard'].validate({ name: 'abcdef', extra: 1 });
    expect(bad).toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ['extra'] }),
        expect.objectContaining({ path: ['name'] }),
        expect.objectContaining({ path: ['at'] }),
      ]),
    });
    expect(input['~standard'].validate([])).toHaveProperty('issues');
    expect(
      shape({ inner: field.json(input) })['~standard'].validate({ inner: { name: 'x', at: 1 } }),
    ).toHaveProperty('issues');
  });
});
