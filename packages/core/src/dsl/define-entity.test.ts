import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { field } from '../fields/field.ts';
import { defineEntity } from './define-entity.ts';

function problemOf(define: () => unknown): string | undefined {
  try {
    define();
  } catch (error) {
    return error instanceof KeelwerkError
      ? (error.details as { readonly code: string }).code
      : String(error);
  }
  return undefined;
}

describe('the defineEntity refusals (sections 14.7.9.2 and 6.4)', () => {
  test('a well-formed entity is accepted', () => {
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'prof',
          fields: {
            email: field
              .string({ maxLength: 254 })
              .personal({ queries: ['eq', 'contains'], eq: {} })
              .unique(),
            note: field.string({ maxLength: 500 }).personal({ queries: ['contains'] }),
            alias: field.string().personal({ eq: { bits: 12 }, queries: ['eq'] }),
          },
        }),
      ),
    ).toBeUndefined();
  });

  test('eq.bits on a unique personal field is refused, however uniqueness is declared', () => {
    const bits = { eq: { bits: 12 }, queries: ['eq'] } as const;
    const refused = 'uniquePersonalFieldTruncatedTags';
    expect(
      problemOf(() =>
        defineEntity({ prefix: 'a', fields: { x: field.string().personal(bits).unique() } }),
      ),
    ).toBe(refused);
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'a',
          fields: { x: field.string().personal(bits) },
          indexes: [{ fields: ['x'], unique: true }],
        }),
      ),
    ).toBe(refused);
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'a',
          fields: { x: field.string().personal(bits).merge('exclusive') },
        }),
      ),
    ).toBe(refused);
  });

  test("keys: 'subject' on a unique personal field is refused", () => {
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'a',
          fields: { x: field.string().personal({ keys: 'subject' }).unique() },
        }),
      ),
    ).toBe('uniquePersonalFieldSubjectKeys');
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'a',
          fields: { x: field.string().personal({ keys: 'subject' }) },
        }),
      ),
    ).toBeUndefined();
  });

  test('contains needs a maxLength of at most 1,024', () => {
    const contains = { queries: ['contains'] } as const;
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'a',
          fields: { x: field.string({ maxLength: 1025 }).personal(contains) },
        }),
      ),
    ).toBe('containsNeedsMaxLength');
    expect(
      problemOf(() =>
        defineEntity({ prefix: 'a', fields: { x: field.string().personal(contains) } }),
      ),
    ).toBe('containsNeedsMaxLength');
    expect(
      problemOf(() =>
        defineEntity({
          prefix: 'a',
          fields: { x: field.string({ maxLength: 1024 }).personal(contains) },
        }),
      ),
    ).toBeUndefined();
  });

  test('a TypeID prefix must match the pattern', () => {
    for (const prefix of ['', 'Prof', 'prof1', '_prof', 'prof_', 'a'.repeat(64)]) {
      expect(problemOf(() => defineEntity({ prefix, fields: { x: field.string() } }))).toBe(
        'invalidTypeIdPrefix',
      );
    }
    for (const prefix of ['a', 'prof', 'my_entity']) {
      expect(
        problemOf(() => defineEntity({ prefix, fields: { x: field.string() } })),
      ).toBeUndefined();
    }
  });

  test('a field name must be camelCase without consecutive capitals', () => {
    for (const name of ['fooBAR', 'Foo', 'foo_bar', 'userID', '1foo']) {
      expect(
        problemOf(() => defineEntity({ prefix: 'a', fields: { [name]: field.string() } })),
      ).toBe('invalidFieldName');
    }
    for (const name of ['foo', 'fooBar', 'foo2Bar', 'a']) {
      expect(
        problemOf(() => defineEntity({ prefix: 'a', fields: { [name]: field.string() } })),
      ).toBeUndefined();
    }
  });

  test('a refusal is core.internal carrying the named problem with its reference', () => {
    try {
      defineEntity({ prefix: 'Prof', fields: { x: field.string() } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      const refused = error as KeelwerkError;
      expect(refused.code).toBe('core.internal');
      expect(refused.details).toMatchObject({
        code: 'invalidTypeIdPrefix',
        severity: 'error',
        ref: 'Prof',
      });
    }
  });
});
