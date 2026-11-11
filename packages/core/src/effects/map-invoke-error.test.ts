import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { uniqueConflict } from '../errors/unique-conflict.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';
import { mapInvokeError } from './map-invoke-error.ts';

const caller = {
  ref: 'relay.forward',
  errors: ['relay.forward_refused'],
  errorSpecs: {
    'relay.forward_refused': {
      kind: 'conflict',
      message: 'The relay could not forward it.',
      retryable: true,
    },
  },
} as unknown as ActionEntry;
const effect = {
  kind: 'invoke',
  type: 'invoke',
  action: 'relay.accept',
  input: {},
  errors: { 'relay.rejected': 'relay.forward_refused' },
} as InvokeEffect;

describe('mapping a failed invoke to the caller error', () => {
  test('a mapped code becomes the caller declared error with its kind, message and retryable', () => {
    const original = new KeelwerkError({
      kind: 'validation',
      code: 'relay.rejected',
      message: 'ada@example.com is refused',
      details: { to: 'ada@example.com' },
    });
    const mapped = mapInvokeError(original, effect, caller) as KeelwerkError;
    expect(mapped).toBeInstanceOf(KeelwerkError);
    expect(mapped).toMatchObject({
      kind: 'conflict',
      code: 'relay.forward_refused',
      message: 'The relay could not forward it.',
      retryable: true,
    });
    expect(mapped.details).toBeUndefined();
    expect(mapped.cause).toBe(original);
  });

  test('an unmapped keelwerk error reaches the caller as the closed projection: kind, code, retryable, retryAfter and the registered message', () => {
    const quoted = new KeelwerkError({
      kind: 'validation',
      code: 'core.validation',
      message: 'The address ada@example.com is not allowed',
      issues: [{ path: ['recipients', 'ada@example.com'], message: 'ada@example.com is refused' }],
      details: { to: 'ada@example.com' },
    });
    const projected = mapInvokeError(quoted, effect, caller) as KeelwerkError;
    expect(projected).toBeInstanceOf(KeelwerkError);
    expect(projected).toMatchObject({
      kind: 'validation',
      code: 'core.validation',
      message: 'The input does not match its schema.',
      retryable: false,
    });
    expect(projected.issues).toBeUndefined();
    expect(projected.details).toBeUndefined();
    // The cause is for the log: it names the invoked action and its code and is never serialised.
    expect((projected.cause as Error).message).toBe(
      'the invoked action "relay.accept" failed with core.validation',
    );
    expect((projected.cause as Error).cause).toBe(quoted);
    expect(JSON.stringify(projected)).not.toContain('example.com');
  });

  test('a code of the invoked command is core.<kind>, and the wait and the retryable pass on', () => {
    const declared = new KeelwerkError({
      kind: 'rate_limited',
      code: 'relay.slow_down',
      message: 'ada@example.com is sending too fast',
      retryable: true,
      retryAfter: 12,
    });
    expect(mapInvokeError(declared, effect, caller)).toMatchObject({
      kind: 'rate_limited',
      code: 'core.rate_limited',
      message: 'Too many requests.',
      retryable: true,
      retryAfter: 12,
    });
    const core = new KeelwerkError({
      kind: 'conflict',
      code: 'core.version_mismatch',
      message: 'row 7 of ada@example.com moved',
    });
    expect(mapInvokeError(core, effect, caller)).toMatchObject({
      kind: 'conflict',
      code: 'core.version_mismatch',
      message: 'The row changed since it was read.',
    });
  });

  test('without a map the same projection applies, and a plain error becomes core.internal with a cause that names the action', () => {
    const unmapped = { kind: 'invoke', type: 'invoke', action: 'x', input: {} } as InvokeEffect;
    const refused = errors.validation('ada@example.com');
    expect(mapInvokeError(refused, unmapped, caller)).toMatchObject({
      code: 'core.validation',
      message: 'The input does not match its schema.',
    });
    const plain = new Error('boom');
    const bug = mapInvokeError(plain, effect, caller) as KeelwerkError;
    expect(bug).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      message: 'An internal error occurred.',
    });
    expect((bug.cause as Error).message).toBe(
      'the invoked action "relay.accept" failed with core.internal',
    );
    expect((bug.cause as Error).cause).toBe(plain);
  });

  test('an error named as itself keeps its code and passes its own details on, only when the declaration has details', () => {
    const detailed = {
      ref: 'auth.signUp',
      errors: ['accounts.email_taken', 'accounts.plain'],
      errorSpecs: {
        'accounts.email_taken': { kind: 'conflict', message: 'In use.', data: {} },
        'accounts.plain': { kind: 'conflict', message: 'Plain.' },
      },
    } as unknown as ActionEntry;
    const passing = {
      kind: 'invoke',
      type: 'invoke',
      action: 'accounts.register',
      input: {},
      errors: {
        'accounts.email_taken': 'accounts.email_taken',
        'accounts.plain': 'accounts.plain',
      },
    } as InvokeEffect;
    const taken = new KeelwerkError({
      kind: 'conflict',
      code: 'accounts.email_taken',
      message: 'ada@example.com again',
      details: { email: 'ada@example.com' },
    });
    expect(mapInvokeError(taken, passing, detailed)).toMatchObject({
      kind: 'conflict',
      code: 'accounts.email_taken',
      message: 'In use.',
      details: { email: 'ada@example.com' },
    });
    const plain = new KeelwerkError({
      kind: 'conflict',
      code: 'accounts.plain',
      message: 'x',
      details: { secret: 'y' },
    });
    expect(mapInvokeError(plain, passing, detailed)).toMatchObject({ code: 'accounts.plain' });
    expect((mapInvokeError(plain, passing, detailed) as KeelwerkError).details).toBeUndefined();
  });

  test('a code that is an inherited object member is not a key', () => {
    const inherited = new KeelwerkError({ kind: 'validation', code: 'toString', message: 'x' });
    expect(mapInvokeError(inherited, effect, caller)).toMatchObject({ code: 'core.validation' });
  });

  test('an adapter retry signal passes through as the same instance, for the caller unit to repeat', () => {
    const lost = new RetryableUnitError('serialization_failure');
    expect(mapInvokeError(lost, effect, caller)).toBe(lost);
  });

  test('the retry markers of a unique conflict and of an ifVersion mismatch pass on, and no other detail does', () => {
    const unique = mapInvokeError(
      uniqueConflict('accounts_profile_email_key', new Error('duplicate key ada@example.com')),
      effect,
      caller,
    ) as KeelwerkError;
    expect(unique).toMatchObject({ kind: 'conflict', code: 'core.conflict' });
    expect(unique.details).toEqual({ unique: true });
    const asked = new KeelwerkError({
      kind: 'conflict',
      code: 'core.version_mismatch',
      message: 'row 7 moved',
      details: { ifVersion: true, entity: 'relay.signal', id: 'ada@example.com' },
    });
    expect(mapInvokeError(asked, effect, caller)).toMatchObject({
      code: 'core.version_mismatch',
      details: { ifVersion: true },
    });
    const plain = new KeelwerkError({
      kind: 'conflict',
      code: 'core.version_mismatch',
      message: 'row 7 moved',
      details: { entity: 'relay.signal', id: 'ada@example.com' },
    });
    expect((mapInvokeError(plain, effect, caller) as KeelwerkError).details).toBeUndefined();
  });
});
