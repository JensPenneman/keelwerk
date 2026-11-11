import { describe, expect, test } from 'vitest';
import { flagTargetingSchema } from './flag-targeting-schema.ts';

const tenant = '11111111-1111-4111-8111-111111111111';

function check(value: unknown) {
  const result = flagTargetingSchema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('asynchronous');
  return result;
}

function messages(value: unknown): string {
  return (check(value).issues ?? []).map((issue) => issue.message).join('|');
}

const valid = {
  enabled: true,
  rules: [
    { id: 'beta', tenants: [tenant], serve: { value: true } },
    {
      id: 'roles',
      when: { principalRoles: { contains: 'beta' } },
      serve: { value: 'x', variant: 'ex' },
    },
  ],
  fallthrough: {
    split: [
      { value: true, weight: 3000 },
      { value: false, weight: 7000 },
    ],
    salt: 'exp:a:1',
  },
};

describe('flagTargetingSchema', () => {
  test('a valid targeting is answered unchanged and passes a second check', () => {
    const first = check(valid);
    expect(first.issues).toBeUndefined();
    const value = first.issues === undefined ? first.value : undefined;
    expect(value).toEqual(valid);
    expect(check(value).issues).toBeUndefined();
  });

  test('weights that do not sum to 10,000 are refused', () => {
    const bad = {
      ...valid,
      fallthrough: {
        split: [
          { value: true, weight: 3000 },
          { value: false, weight: 6000 },
        ],
      },
    };
    expect(messages(bad)).toContain('sum to 10000');
    expect(
      messages({ ...valid, fallthrough: { split: [{ value: true, weight: 0.5 }] } }),
    ).toContain('integer');
  });

  test('duplicate rule ids are refused', () => {
    const rule = { id: 'same', tenants: [tenant], serve: { value: true } };
    expect(messages({ ...valid, rules: [rule, rule] })).toContain('used twice');
  });

  test('a rule without criterion is refused', () => {
    expect(messages({ ...valid, rules: [{ id: 'none', serve: { value: true } }] })).toContain(
      'at least one',
    );
  });

  test('a condition over an attribute the kernel does not set is refused', () => {
    const bad = {
      ...valid,
      rules: [{ id: 'mail', when: { email: 'a@b.c' }, serve: { value: true } }],
    };
    expect(messages(bad)).toContain('"email" is not set by the kernel');
  });

  test('a relation quantifier is refused', () => {
    const bad = {
      ...valid,
      rules: [{ id: 'rel', when: { some: { orders: { id: 'x' } } }, serve: { value: true } }],
    };
    expect(check(bad).issues).toBeDefined();
  });

  test('a value that is not plain JSON, or holds U+0000, is refused', () => {
    expect(
      check({ ...valid, fallthrough: { value: new Date(), variant: 'd' } }).issues,
    ).toBeDefined();
    expect(check({ ...valid, fallthrough: { value: 'a\u0000b' } }).issues).toBeDefined();
    expect(
      check({ ...valid, fallthrough: { value: { a: Number.NaN }, variant: 'n' } }).issues,
    ).toBeDefined();
    expect(check({ ...valid, fallthrough: { value: () => 1 } }).issues).toBeDefined();
  });

  test('a salt holding U+0000 or a lone surrogate is refused with its path', () => {
    const split = [{ value: true, weight: 10_000 }];
    const withSalt = (salt: string) => ({ ...valid, fallthrough: { split, salt } });
    const refused = check(withSalt('exp:x\u0000'));
    expect(refused.issues?.map((issue) => issue.path)).toEqual([['fallthrough', 'salt']]);
    expect(check(withSalt('exp:x\ud800')).issues).toBeDefined();
    expect(check(withSalt('exp:x')).issues).toBeUndefined();
  });

  test('an object value without variant is refused', () => {
    expect(messages({ ...valid, fallthrough: { value: { a: 1 } } })).toContain('needs a variant');
    expect(
      check({ ...valid, fallthrough: { value: { a: 1 }, variant: 'one' } }).issues,
    ).toBeUndefined();
  });

  test('a condition or principal id holding U+0000 or a lone surrogate is refused', () => {
    const rule = (extra: Record<string, unknown>) => ({
      ...valid,
      rules: [{ id: 'x', serve: { value: true }, ...extra }],
    });
    expect(check(rule({ when: { principalKind: { eq: 'x\u0000y' } } })).issues).toBeDefined();
    expect(check(rule({ when: { principalKind: { eq: 'x\ud800y' } } })).issues).toBeDefined();
    expect(check(rule({ principals: ['x\u0000y'] })).issues).toBeDefined();
    expect(check(rule({ principals: ['x\ud800y'] })).issues).toBeDefined();
    expect(check(rule({ principals: ['ada'] })).issues).toBeUndefined();
  });

  test('a condition longer than 65,536 characters is refused', () => {
    const items = Array.from({ length: 10_000 }, (_, index) => `kind-${index}-padding`);
    const targeting = {
      ...valid,
      rules: [{ id: 'big', when: { principalKind: { in: items } }, serve: { value: true } }],
    };
    expect(messages(targeting)).toContain('longer than');
  });
});
