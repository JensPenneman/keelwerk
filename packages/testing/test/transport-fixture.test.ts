import { expect, test } from 'vitest';
import { apiVersion } from '../src/fixtures/apps/transport/src/keelwerk.generated.ts';
import { transportApp } from '../src/fixtures/index.ts';

test('the generated file of the transport fixture app names the head of its API versions', () => {
  expect(apiVersion).toBe(transportApp.api?.dates.at(-1));
  expect(transportApp.registry.actions.has('loans.about')).toBe(true);
});
