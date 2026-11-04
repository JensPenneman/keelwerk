import { expect, test } from 'vitest';
import { trackIdOf } from './track-id-of.ts';

test('a conditional part with several when modules gets one id in any order', () => {
  expect(trackIdOf('auth', null, ['teams', 'billing'])).toBe('auth[billing,teams]');
  expect(trackIdOf('auth', null, ['billing', 'teams'])).toBe('auth[billing,teams]');
  expect(trackIdOf('auth', 'projects', ['teams', 'billing'])).toBe('auth->projects[billing,teams]');
});

test('a part with no when list and no other target is the module id', () => {
  expect(trackIdOf('auth', null, [])).toBe('auth');
  expect(trackIdOf('auth', 'auth', [])).toBe('auth');
  expect(trackIdOf('auth', 'accounts', [])).toBe('auth->accounts');
});
