import { defineReaction, invoke, system, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { registerErrorMap } from '../../../lib/register-error-map.ts';
import { whenAccounts } from '../condition.ts';

/**
 * A sign-up creates its profile in the same unit, by the accounts action (S-40). Profiles are never
 * looked at first: `accounts.register` decides, so its gate answers the same for every address,
 * and an address that already has a profile fails the unit with `accounts.email_taken`, which
 * is what M1 answered (S-112) and still is: the invoke names each error of the registration as
 * itself (`registerErrorMap`), and the sign-up declares them, so its surface lists them.
 */
export const registerProfile = defineReaction(within(authBase, whenAccounts), {
  on: 'auth.credential.signedUp',
  timing: 'inline',
  react(event) {
    const identifier = event.state.identifier;
    if (identifier === undefined) return [];
    return {
      effects: [
        invoke(
          'accounts.register',
          { displayName: event.data.displayName ?? identifier, email: identifier },
          { as: system('create the profile of a sign-up'), errors: registerErrorMap },
        ),
      ],
    };
  },
});
