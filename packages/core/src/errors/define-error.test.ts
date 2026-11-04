import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { defineError } from './define-error.ts';
import { errors } from './errors.ts';
import { isKeelwerkError } from './is-keelwerk-error.ts';
import { KeelwerkError } from './keelwerk-error.ts';

const emailSchema: StandardSchemaV1<unknown, { readonly email: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => ({ value: value as { readonly email: string } }),
  },
};

describe('defineError', () => {
  it('builds an error of its code, kind, message and typed details', () => {
    const emailTaken = defineError('accounts.email_taken', {
      kind: 'conflict',
      data: emailSchema,
      message: 'This e-mail address is already in use.',
    });
    expect(emailTaken.code).toBe('accounts.email_taken');
    const error = emailTaken({ email: 'a@b.c' }, { retryable: true });
    expect(error).toBeInstanceOf(KeelwerkError);
    expect(error.kind).toBe('conflict');
    expect(error.details).toEqual({ email: 'a@b.c' });
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('This e-mail address is already in use.');
  });

  it('takes options only when no data schema is declared', () => {
    const slow = defineError('jobs.slow', { kind: 'unavailable', message: 'Slow.' });
    const error = slow({ retryAfter: 3, message: 'Slower.', cause: new Error('x') });
    expect(error.retryAfter).toBe(3);
    expect(error.message).toBe('Slower.');
    expect(error.retryable).toBe(true);
    expect((error.cause as Error).message).toBe('x');
    expect(slow().details).toBeUndefined();
  });

  it('honours the retryable override of the spec', () => {
    const quota = defineError('billing.quota', {
      kind: 'rate_limited',
      message: 'Quota.',
      retryable: false,
    });
    expect(quota().retryable).toBe(false);
  });

  it('refuses a code outside <module>.<snake_case>', () => {
    for (const code of [
      'email_taken',
      'Accounts.email_taken',
      'accounts.emailTaken',
      'accounts.',
      'accounts.a__b',
      'a.b.c',
      'accounts.email-taken',
    ]) {
      expect(() => defineError(code, { kind: 'conflict', message: 'x' })).toThrow(TypeError);
    }
    expect(() =>
      defineError('api-keys.already_revoked', { kind: 'conflict', message: 'x' }),
    ).not.toThrow();
  });
});

describe('errors', () => {
  it('builds one error per kind under core.<kind>', () => {
    const error = errors.forbidden('Self-registration is disabled.');
    expect(error.kind).toBe('forbidden');
    expect(error.code).toBe('core.forbidden');
    expect(errors.unavailable('x').retryable).toBe(true);
    expect(errors.not_found('x', { cause: 1 }).cause).toBe(1);
    expect(Object.keys(errors)).toHaveLength(10);
  });
});

describe('isKeelwerkError', () => {
  it('recognises the class and look-alikes, not other errors', () => {
    expect(isKeelwerkError(errors.internal('x'))).toBe(true);
    const lookAlike = Object.assign(new Error('x'), {
      name: 'KeelwerkError',
      kind: 'internal',
      code: 'a.b',
      retryable: false,
    });
    expect(isKeelwerkError(lookAlike)).toBe(true);
    expect(isKeelwerkError(Object.assign(lookAlike, { kind: 'bogus' }))).toBe(false);
    const noRetry = Object.assign(new Error('x'), {
      name: 'KeelwerkError',
      kind: 'internal',
      code: 'a.b',
    });
    expect(isKeelwerkError(noRetry)).toBe(false);
    expect(isKeelwerkError(new Error('x'))).toBe(false);
    expect(isKeelwerkError({ kind: 'internal', code: 'a.b' })).toBe(false);
    expect(isKeelwerkError(undefined)).toBe(false);
  });
});
