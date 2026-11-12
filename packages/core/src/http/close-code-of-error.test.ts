import { describe, expect, test } from 'vitest';
import type { ErrorKind } from '../errors/error-kind.ts';
import { closeCodeOfError } from './close-code-of-error.ts';

describe('closeCodeOfError', () => {
  test('each error kind has the close code of 16.4.6', () => {
    const expected: readonly (readonly [ErrorKind, number])[] = [
      ['validation', 4400],
      ['unauthenticated', 4401],
      ['forbidden', 4403],
      ['not_found', 4404],
      ['conflict', 4409],
      ['rate_limited', 4429],
      ['not_implemented', 4501],
      ['unavailable', 1013],
      ['unsupported', 4422],
      ['internal', 1011],
    ];
    for (const [kind, code] of expected) expect(closeCodeOfError(kind)).toBe(code);
  });
});
