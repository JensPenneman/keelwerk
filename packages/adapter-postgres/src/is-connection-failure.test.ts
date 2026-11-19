import { errors } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { isConnectionFailure } from './is-connection-failure.ts';

const withCode = (code: string): Error => Object.assign(new Error('driver'), { code });

describe('isConnectionFailure', () => {
  test('class 08, 57P01-57P03 and 53300 are connection failures', () => {
    for (const code of ['08000', '08006', '08P01', '57P01', '57P02', '57P03', '53300']) {
      expect(isConnectionFailure(withCode(code))).toBe(true);
    }
  });

  test('socket error codes are connection failures', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT']) {
      expect(isConnectionFailure(withCode(code))).toBe(true);
    }
    for (const code of ['EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN']) {
      expect(isConnectionFailure(withCode(code))).toBe(true);
    }
  });

  test("the driver's messages without a code are connection failures", () => {
    for (const message of [
      'Connection terminated unexpectedly',
      'Connection terminated',
      'Connection terminated due to connection timeout',
      'timeout exceeded when trying to connect',
      'Client has encountered a connection error and is not queryable',
      'Client was closed and is not queryable',
      'Cannot use a pool after calling end on the pool',
      'driver has already been destroyed',
    ]) {
      expect(isConnectionFailure(new Error(message))).toBe(true);
    }
  });

  test('23505, 40001, 57014, a plain Error and a KeelwerkError are not', () => {
    for (const code of ['23505', '40001', '57014']) {
      expect(isConnectionFailure(withCode(code))).toBe(false);
    }
    expect(isConnectionFailure(new Error('boom'))).toBe(false);
    expect(isConnectionFailure('Connection terminated')).toBe(false);
    expect(isConnectionFailure(errors.unavailable('gone'))).toBe(false);
  });
});
