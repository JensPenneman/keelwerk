import { describe, expect, it } from 'vitest';
import { AppNotServedError } from './app-not-served-error.ts';
import { isAppNotServedError } from './is-app-not-served-error.ts';

describe('isAppNotServedError', () => {
  it('recognises the real class', () => {
    expect(isAppNotServedError(new AppNotServedError('library'))).toBe(true);
  });

  it('recognises a look-alike made by another copy of the core', () => {
    const lookAlike = Object.assign(new RangeError('not served'), {
      name: 'AppNotServedError',
      appId: 'library',
    });
    expect(lookAlike).not.toBeInstanceOf(AppNotServedError);
    expect(isAppNotServedError(lookAlike)).toBe(true);
  });

  it('rejects a plain RangeError', () => {
    expect(isAppNotServedError(new RangeError('out of range'))).toBe(false);
  });

  it('rejects a RangeError with the name but no appId', () => {
    const nameOnly = Object.assign(new RangeError('x'), { name: 'AppNotServedError' });
    expect(isAppNotServedError(nameOnly)).toBe(false);
  });

  it('rejects a value that is not an error', () => {
    expect(isAppNotServedError({ name: 'AppNotServedError', appId: 'library' })).toBe(false);
    expect(isAppNotServedError(undefined)).toBe(false);
    expect(isAppNotServedError('AppNotServedError')).toBe(false);
  });
});
