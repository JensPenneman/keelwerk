import { isKeelwerkError } from '@keelwerk/core';
import { expect } from 'vitest';

/**
 * Asserts that the policy let a call through: it succeeds, or fails with an error the action
 * declares. Any `core.*` failure (unauthenticated, forbidden, validation, not found, ...) means the
 * call did not get through the pipeline and fails the matcher; a rejection that is not a
 * `KeelwerkError` is rethrown.
 */
export async function expectAllowed(call: Promise<unknown>): Promise<void> {
  const error = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (error === undefined) return;
  if (!isKeelwerkError(error)) throw error;
  expect(
    error.code.startsWith('core.'),
    `the call did not reach the action (${error.code}${error.reason === undefined ? '' : `: ${error.reason}`}) ${JSON.stringify(error.rules ?? [])}`,
  ).toBe(false);
}
