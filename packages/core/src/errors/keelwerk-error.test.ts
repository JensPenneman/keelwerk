import { describe, expect, it } from 'vitest';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';
import { KeelwerkError } from './keelwerk-error.ts';

describe('KeelwerkError', () => {
  it('is an Error carrying kind, code and message', () => {
    const error = new KeelwerkError({
      kind: 'conflict',
      code: 'accounts.email_taken',
      message: 'This e-mail address is already in use.',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KeelwerkError');
    expect(error.kind).toBe('conflict');
    expect(error.code).toBe('accounts.email_taken');
    expect(error.retryable).toBe(false);
    expect('issues' in error).toBe(false);
  });

  it('defaults retryable by kind and keeps what it was given', () => {
    const unavailable = new KeelwerkError({
      kind: 'unavailable',
      code: 'core.timeout',
      message: 'x',
    });
    expect(unavailable.retryable).toBe(true);
    const quota = new KeelwerkError({
      kind: 'rate_limited',
      code: 'core.quota_exceeded',
      message: 'x',
      retryable: false,
      retryAfter: 3,
      rules: [{ id: 'a.b.c', effect: 'deny' }],
      issues: [{ path: ['name', 0], message: 'm' }],
      details: { n: 1 },
      cause: unavailable,
    });
    expect(quota.retryable).toBe(false);
    expect(quota.retryAfter).toBe(3);
    expect(quota.rules).toEqual([{ id: 'a.b.c', effect: 'deny' }]);
    expect(quota.issues).toEqual([{ path: ['name', 0], message: 'm' }]);
    expect(quota.details).toEqual({ n: 1 });
    expect(quota.cause).toBe(unavailable);
  });
});

describe('RetryableUnitError', () => {
  it('is an Error naming the reason', () => {
    const error = new RetryableUnitError('deadlock');
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(KeelwerkError);
    expect(error.reason).toBe('deadlock');
    expect(error.name).toBe('RetryableUnitError');
  });
});
