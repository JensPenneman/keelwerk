import { testOperator } from '@keelwerk/testing';
import { expect } from 'vitest';
import type { BootedOwnerApp } from './boot-owner-app.ts';

const operator = testOperator();

/**
 * Runs `act`, and deactivates the profile when the first write unit of `act` is about to open: its
 * request was admitted before the deactivation, and its unit commits after it.
 */
export async function acrossDeactivation(
  app: BootedOwnerApp,
  profileId: string,
  act: () => Promise<unknown>,
): Promise<void> {
  const target = app.runtime.adapter as { unit: typeof app.runtime.adapter.unit };
  const inner = target.unit.bind(app.runtime.adapter);
  let overtaken = false;
  target.unit = async (namespace, scope, fn, options) => {
    if (!overtaken && options?.readOnly !== true) {
      overtaken = true;
      const done = await app
        .client(operator)
        .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
      expect(done.ok ? undefined : done.error).toBeUndefined();
    }
    return inner(namespace, scope, fn, options);
  };
  await act();
  target.unit = inner;
  expect(overtaken).toBe(true);
}
