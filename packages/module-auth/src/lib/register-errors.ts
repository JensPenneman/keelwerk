import type { AnyErrorDefinition } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';

function declaredBy(action: object): readonly AnyErrorDefinition[] {
  const spec: unknown = Reflect.get(action, 'spec');
  const errors: unknown =
    typeof spec === 'object' && spec !== null ? Reflect.get(spec, 'errors') : [];
  return Array.isArray(errors) ? errors : [];
}

/**
 * The errors `accounts.register` declares. A sign-up creates its profile by that action, so a
 * failure of the registration (an address that already has a profile) reaches the caller as the
 * error the action declares; the sign-up lists them so none is reported as `internal`.
 */
export const registerErrors: readonly AnyErrorDefinition[] = declaredBy(accounts.actions.register);
