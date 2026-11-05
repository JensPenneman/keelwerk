import { expect, test } from 'vitest';
import { portal } from '../src/app.ts';
import { apiVersion } from '../src/keelwerk.generated.ts';

test('the generated file of the portal names the head of its API versions', () => {
  expect(apiVersion).toBe(portal.api?.dates.at(-1));
  expect(portal.registry.actions.has('auth.login')).toBe(true);
  expect(portal.registry.actions.has('accounts.register')).toBe(true);
});
