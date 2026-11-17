import { describe, expect, it } from 'vitest';
import { errorKinds } from './error-kinds.ts';
import { isErrorKind } from './is-error-kind.ts';

describe('isErrorKind', () => {
  it.each(errorKinds)('accepts the kind %s', (kind) => {
    expect(isErrorKind(kind)).toBe(true);
  });

  it.each([
    'toString',
    'constructor',
    '__proto__',
    'hasOwnProperty',
    'valueOf',
    '',
    'Validation',
    'unknown',
  ])('refuses the string %j, even a name inherited from the object prototype', (value) => {
    expect(isErrorKind(value)).toBe(false);
  });

  it.each([1, undefined, null, {}, ['internal']])('refuses the non-string %j', (value) => {
    expect(isErrorKind(value)).toBe(false);
  });
});
