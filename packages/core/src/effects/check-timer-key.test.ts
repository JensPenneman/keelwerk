import { expect, test } from 'vitest';
import { checkTimerKey } from './check-timer-key.ts';

test('a key that starts with core: is a validation error that does not name the key', () => {
  let caught: unknown;
  try {
    checkTimerKey('core:deadline:secret-id');
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ kind: 'validation', code: 'core.validation' });
  expect(JSON.stringify(caught)).not.toContain('secret-id');
  expect((caught as Error).message).toContain('"core:"');
});

test('any other key passes, a key that only contains core: included', () => {
  for (const key of ['offline:1', 'x:core:y', 'Core:1', 'core', '']) {
    expect(() => checkTimerKey(key)).not.toThrow();
  }
});
