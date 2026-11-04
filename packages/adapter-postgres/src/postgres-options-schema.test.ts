import { describe, expect, test } from 'vitest';
import { postgresOptionsSchema } from './postgres-options-schema.ts';

const validate = (value: unknown): unknown => postgresOptionsSchema['~standard'].validate(value);

describe('postgresOptionsSchema', () => {
  test('absent options take the defaults', () => {
    expect(validate(undefined)).toEqual({
      value: { idleInTransactionTimeoutMs: 30_000, connectionTimeoutMs: 10_000 },
    });
    expect(validate({})).toEqual({
      value: { idleInTransactionTimeoutMs: 30_000, connectionTimeoutMs: 10_000 },
    });
  });

  test('given values are kept', () => {
    expect(validate({ idleInTransactionTimeoutMs: 5000, connectionTimeoutMs: 2000 })).toEqual({
      value: { idleInTransactionTimeoutMs: 5000, connectionTimeoutMs: 2000 },
    });
  });

  test('unknown keys, non-objects and non-positive numbers are issues', () => {
    expect(validate({ pool: 1 })).toMatchObject({ issues: [{ path: ['pool'] }] });
    expect(validate([])).toMatchObject({ issues: [{}] });
    expect(validate({ connectionTimeoutMs: 0 })).toMatchObject({
      issues: [{ path: ['connectionTimeoutMs'] }],
    });
    expect(validate({ idleInTransactionTimeoutMs: '5' })).toMatchObject({
      issues: [{ path: ['idleInTransactionTimeoutMs'] }],
    });
  });
});
