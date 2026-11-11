import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { reactionJobError } from './reaction-job-error.ts';

const declared = new Set(['logs.refused']);

describe('the error a failed reaction job keeps', () => {
  test('free text, details and issues are gone; the message is fixed', () => {
    const error = reactionJobError(
      new KeelwerkError({
        kind: 'unavailable',
        code: 'core.unavailable',
        message: 'Cannot reach ada@example.com.',
        details: { to: 'ada@example.com' },
        issues: [{ path: ['to'], message: 'ada@example.com' }],
        retryAfter: 4.2,
      }),
      declared,
    );
    expect(error).toMatchObject({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'The reaction failed with core.unavailable.',
      retryable: true,
      retryAfter: 5,
    });
    expect(error.details).toBeUndefined();
    expect(error.issues).toBeUndefined();
  });

  test('a code the module declares stays, a foreign code becomes core.<kind>', () => {
    const own = new KeelwerkError({ kind: 'validation', code: 'logs.refused', message: 'x' });
    const foreign = new KeelwerkError({ kind: 'conflict', code: 'other.taken', message: 'x' });
    expect(reactionJobError(own, declared).code).toBe('logs.refused');
    expect(reactionJobError(foreign, declared)).toMatchObject({
      kind: 'conflict',
      code: 'core.conflict',
      message: 'The reaction failed with core.conflict.',
    });
  });

  test('a throw that is no keelwerk error is internal, and a lost lease stays recognisable', () => {
    expect(reactionJobError(new Error('boom ada@example.com'), declared)).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: 'The reaction failed with core.internal.',
    });
    expect(
      reactionJobError(
        new KeelwerkError({ kind: 'unavailable', code: 'core.job_lease_lost', message: 'x' }),
        declared,
      ).code,
    ).toBe('core.job_lease_lost');
    expect(errors.internal('x')).toBeInstanceOf(KeelwerkError);
  });
});
