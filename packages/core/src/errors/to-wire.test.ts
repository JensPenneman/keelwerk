import { describe, expect, it } from 'vitest';
import type { CoreErrorCode } from './core-error-code.ts';
import { coreErrorCodes } from './core-error-codes.ts';
import { createError } from './create-error.ts';
import type { ErrorAudience } from './error-audience.ts';
import { toWire } from './to-wire.ts';

const audiences: readonly ErrorAudience[] = ['public', 'operator', 'development'];
const codes = Object.keys(coreErrorCodes) as CoreErrorCode[];

describe('toWire', () => {
  it('serialises every core code for every audience', () => {
    for (const code of codes) {
      const spec = coreErrorCodes[code];
      for (const audience of audiences) {
        const error = createError(spec.kind, code, spec.message, undefined, {}, spec.retryable);
        const wire = toWire(error, audience);
        expect(wire.code).toBe(code);
        expect(wire.kind).toBe(spec.kind);
        expect(wire.retryable).toBe(error.retryable);
        const redacted = spec.kind === 'internal' && audience === 'public';
        expect(wire.message).toBe(redacted ? 'Internal server error.' : spec.message);
      }
    }
  });

  it('shows rule ids only to operators and development', () => {
    const error = createError('forbidden', 'core.forbidden', 'No.', undefined, {
      rules: [{ id: 'accounts.admin_only', effect: 'deny' }],
    });
    expect(toWire(error, 'public').rules).toBeUndefined();
    expect(toWire(error, 'operator').rules).toEqual([
      { id: 'accounts.admin_only', effect: 'deny' },
    ]);
    expect(toWire(error, 'development').rules).toHaveLength(1);
    expect(toWire(error, 'public').reason).toBe('No.');
  });

  it('redacts internal messages and details for the public only', () => {
    const error = createError(
      'internal',
      'core.row_outside_plan',
      'secret table x',
      { row: 1 },
      {},
    );
    const publicWire = toWire(error, 'public');
    expect(publicWire.message).not.toContain('secret');
    expect(publicWire.details).toBeUndefined();
    expect(toWire(error, 'operator').message).toBe('secret table x');
    expect(toWire(error, 'development').details).toEqual({ row: 1 });
  });

  it('carries issues with printable paths, details and retryAfter', () => {
    const error = createError(
      'validation',
      'accounts.bad',
      'Bad.',
      { field: 'email' },
      { issues: [{ path: ['items', 2, Symbol('k')], message: 'x' }], retryAfter: 5 },
    );
    const wire = toWire(error, 'public');
    expect(wire.issues).toEqual([{ path: ['items', 2, 'Symbol(k)'], message: 'x' }]);
    expect(wire.details).toEqual({ field: 'email' });
    expect(wire.retryAfter).toBe(5);
    expect('rules' in wire).toBe(false);
  });
});
