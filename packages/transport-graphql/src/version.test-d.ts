import { expectTypeOf, test } from 'vitest';
import { version } from './version.ts';

test('the version is a string', () => {
  expectTypeOf(version).toBeString();
});
