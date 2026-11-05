import { describe, expect, test } from 'vitest';
import { placementRole } from './placement-role.ts';

describe('placementRole', () => {
  test('a lower-case user name is the role', () => {
    expect(placementRole('main', 'postgres://kw_app:secret@localhost/db')).toBe('kw_app');
  });

  test('a url without a user names no role', () => {
    expect(placementRole('main', 'postgres://localhost/db')).toBeUndefined();
    expect(placementRole('main', undefined)).toBeUndefined();
  });

  test.each([
    ['upper case', 'postgres://App@localhost/db'],
    ['a quote', 'postgres://a%22b@localhost/db'],
    ['the reserved pg_ prefix', 'postgres://pg_x@localhost/db'],
  ])('%s is refused with a validation error naming the placement', (_name, url) => {
    expect(() => placementRole('main', url)).toThrow(
      expect.objectContaining({ kind: 'validation', message: expect.stringContaining('main') }),
    );
  });
});
