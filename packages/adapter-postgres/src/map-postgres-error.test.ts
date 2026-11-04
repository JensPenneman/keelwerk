import { isKeelwerkError, RetryableUnitError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { mapPostgresError } from './map-postgres-error.ts';

describe('mapPostgresError', () => {
  test('23505 is a conflict that keeps the driver error as its cause', () => {
    const driver = Object.assign(new Error('duplicate key'), { code: '23505' });
    const mapped = mapPostgresError(driver);
    expect(isKeelwerkError(mapped)).toBe(true);
    expect(mapped).toMatchObject({ kind: 'conflict', cause: driver });
  });

  test('40001 is a retryable serialization failure', () => {
    const mapped = mapPostgresError(
      Object.assign(new Error('could not serialize'), { code: '40001' }),
    );
    expect(mapped).toBeInstanceOf(RetryableUnitError);
    expect(mapped).toMatchObject({ reason: 'serialization_failure' });
  });

  test('40P01 is a retryable deadlock', () => {
    const mapped = mapPostgresError(
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    );
    expect(mapped).toBeInstanceOf(RetryableUnitError);
    expect(mapped).toMatchObject({ reason: 'deadlock' });
  });

  test('any other error, and a non-error, is returned as it is', () => {
    const other = Object.assign(new Error('permission denied'), { code: '42501' });
    expect(mapPostgresError(other)).toBe(other);
    expect(mapPostgresError('text')).toBe('text');
    expect(mapPostgresError(null)).toBeNull();
  });
});
