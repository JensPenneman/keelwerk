import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { attemptErrorOf } from './attempt-error-of.ts';

const requestId = '0198a1e0-0000-7000-8000-0000000000a1';
const noCodes: ReadonlySet<string> = new Set();

describe('attemptErrorOf', () => {
  test('keeps the kind, code, retry flag, wait and request id and never the message', () => {
    const error = new KeelwerkError({
      kind: 'rate_limited',
      code: 'mail.slow_down',
      message: '550 5.1.1 <ada@example.org> mailbox unavailable',
      retryAfter: 30,
    });
    const projected = attemptErrorOf(error, requestId, new Set(['mail.slow_down']));
    expect(projected).toEqual({
      kind: 'rate_limited',
      code: 'mail.slow_down',
      retryable: true,
      retryAfter: 30,
      requestId,
    });
    expect(JSON.stringify(projected)).not.toContain('ada@example.org');
  });

  test('a code that is free text becomes core.<kind>, so no personal value rides in the code', () => {
    const error = new KeelwerkError({
      kind: 'validation',
      code: 'rejected ada@example.org',
      message: 'no',
    });
    const projected = attemptErrorOf(error, requestId, noCodes);
    expect(projected.code).toBe('core.validation');
    expect(JSON.stringify(projected)).not.toContain('ada@example.org');
  });

  test('a throw that is no keelwerk error is internal with core.internal', () => {
    expect(
      attemptErrorOf(new TypeError('cannot read ada@example.org'), requestId, noCodes),
    ).toEqual({
      kind: 'internal',
      code: 'core.internal',
      retryable: false,
      requestId,
    });
    expect(attemptErrorOf('a string', requestId, noCodes).code).toBe('core.internal');
  });

  test('a kind-level error has the code core.<kind>', () => {
    expect(attemptErrorOf(errors.unavailable('down'), requestId, noCodes)).toEqual({
      kind: 'unavailable',
      code: 'core.unavailable',
      retryable: true,
      requestId,
    });
  });

  test('a well-formed code the effect module did not declare is core.<kind>: free text can ride in a code of the right form', () => {
    const error = new KeelwerkError({
      kind: 'validation',
      code: 'mail.rejected_ada_example_org',
      message: 'no',
    });
    expect(attemptErrorOf(error, requestId, noCodes).code).toBe('core.validation');
    expect(attemptErrorOf(error, requestId, new Set(['mail.rejected'])).code).toBe(
      'core.validation',
    );
    expect(attemptErrorOf(error, requestId, new Set(['mail.rejected_ada_example_org'])).code).toBe(
      'mail.rejected_ada_example_org',
    );
  });

  test('a code that is not registered in the core, even with the core prefix, becomes core.<kind>', () => {
    const error = new KeelwerkError({ kind: 'conflict', code: 'core.made_up', message: 'no' });
    expect(attemptErrorOf(error, requestId, noCodes).code).toBe('core.conflict');
  });

  test.each([
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [-5, undefined],
    [0, 0],
    [1.2, 2],
    [10 ** 9, 86_400],
  ])('a wait of %s seconds is stored as %s', (given, stored) => {
    const error = new KeelwerkError({
      kind: 'rate_limited',
      code: 'core.rate_limited',
      message: 'slow',
      retryAfter: given,
    });
    const projected = attemptErrorOf(error, requestId, noCodes);
    expect(projected.retryAfter).toBe(stored);
    expect(Object.hasOwn(projected, 'retryAfter')).toBe(stored !== undefined);
  });
});
