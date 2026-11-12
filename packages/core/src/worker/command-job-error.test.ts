import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { commandJobError } from './command-job-error.ts';

const declared: ReadonlySet<string> = new Set(['accounts.email_taken']);

describe('commandJobError (D9)', () => {
  test('a declared error with the address in its data stores its code and the fixed message only', () => {
    const stored = commandJobError(
      new KeelwerkError({
        kind: 'conflict',
        code: 'accounts.email_taken',
        message: 'ann@example.test is taken',
        details: { email: 'ann@example.test' },
        issues: [{ path: ['email'], message: 'ann@example.test is taken' }],
      }),
      declared,
    );
    expect(stored.code).toBe('accounts.email_taken');
    expect(stored.kind).toBe('conflict');
    expect(stored.message).toBe('The command failed with accounts.email_taken.');
    expect(stored.details).toBeUndefined();
    expect(stored.issues).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('ann@example.test');
  });

  test('an undeclared code becomes core.<kind>', () => {
    const stored = commandJobError(
      new KeelwerkError({ kind: 'conflict', code: 'other.taken', message: 'x', retryable: false }),
      declared,
    );
    expect(stored.code).toBe('core.conflict');
    expect(stored.message).toBe('The command failed with core.conflict.');
  });

  test('a code of the core is kept, with its retry hints', () => {
    const stored = commandJobError(
      new KeelwerkError({
        kind: 'unavailable',
        code: 'core.unavailable',
        message: 'down for ann@example.test',
        retryable: true,
        retryAfter: 2.5,
      }),
      declared,
    );
    expect(stored).toMatchObject({ code: 'core.unavailable', retryable: true, retryAfter: 3 });
  });

  test('a throw that is no keelwerk error is internal', () => {
    expect(commandJobError(new Error('secret@example.test'), declared)).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: 'The command failed with core.internal.',
    });
  });
});
