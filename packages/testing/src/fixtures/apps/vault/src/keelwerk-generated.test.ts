import { expect, test } from 'vitest';
import { vault } from './app.ts';
import { apiVersion } from './keelwerk.generated.ts';

test('the generated file names the head API version of the vault app', () => {
  expect(apiVersion).toBe('2026-11-04');
  expect(vault.registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
});
