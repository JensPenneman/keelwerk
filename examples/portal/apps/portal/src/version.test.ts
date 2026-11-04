import { expect, test } from 'vitest';
import { version } from './version.ts';

test('the version is a semantic version', () => {
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
});
