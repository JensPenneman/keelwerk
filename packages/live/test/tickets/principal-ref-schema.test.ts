import { describe, expect, test } from 'vitest';
import { principalRefSchema } from '../../src/tickets/principal-ref-schema.ts';

const validate = (value: unknown) => principalRefSchema['~standard'].validate(value);

describe('the stored form of a principal reference', () => {
  test('keeps every member the resolving module adds, so fromRef reads what a job stores', () => {
    const ref = {
      resolver: 'auth.session',
      principalId: 'u1',
      credentialId: 'c1',
      sessionId: 's1',
    };
    expect(validate(ref)).toEqual({ value: ref });
  });

  test('keeps nested JSON members and a copy, not the object it was given', () => {
    const ref = { resolver: 'r', principalId: 'p', claims: { admin: [true, null, 1.5, 'x'] } };
    const result = validate(ref);
    expect(result).toEqual({ value: ref });
    expect('value' in result && result.value).not.toBe(ref);
  });

  test.each([
    ['null', null],
    ['an array', []],
    ['no resolver', { principalId: 'p' }],
    ['no principal id', { resolver: 'r' }],
    ['a numeric resolver', { resolver: 1, principalId: 'p' }],
  ])('refuses %s', (_name, value) => {
    expect(validate(value)).toHaveProperty('issues');
  });

  test.each([
    ['a function', () => 1],
    ['undefined', undefined],
    ['a bigint', 1n],
    ['a date', new Date()],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('refuses a member that is %s', (_name, member) => {
    expect(validate({ resolver: 'r', principalId: 'p', member })).toHaveProperty('issues');
  });

  test('refuses a reference that is too large or nests too deep', () => {
    expect(validate({ resolver: 'r', principalId: 'p', blob: 'x'.repeat(3000) })).toHaveProperty(
      'issues',
    );
    let deep: unknown = 1;
    for (let level = 0; level < 10; level += 1) deep = { deep };
    expect(validate({ resolver: 'r', principalId: 'p', deep })).toHaveProperty('issues');
  });
});
