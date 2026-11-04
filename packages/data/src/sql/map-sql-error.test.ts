import { isKeelwerkError, RetryableUnitError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { mapSqlError } from './map-sql-error.ts';

const withCode = (code: string): Error => Object.assign(new Error('driver'), { code });

describe('mapSqlError', () => {
  test('a foreign-key violation is a conflict: the referenced row is missing', () => {
    const driver = withCode('23503');
    const mapped = mapSqlError(driver);
    expect(isKeelwerkError(mapped)).toBe(true);
    expect(mapped).toMatchObject({
      kind: 'conflict',
      code: 'core.reference_missing',
      cause: driver,
    });
  });

  test('a unique violation is a conflict and the retryable failures stay retryable', () => {
    expect(mapSqlError(withCode('23505'))).toMatchObject({ kind: 'conflict' });
    expect(mapSqlError(withCode('40001'))).toBeInstanceOf(RetryableUnitError);
    expect(mapSqlError(withCode('40P01'))).toBeInstanceOf(RetryableUnitError);
  });

  test('anything else is returned as it is', () => {
    const other = withCode('42501');
    expect(mapSqlError(other)).toBe(other);
    expect(mapSqlError('text')).toBe('text');
  });
});
