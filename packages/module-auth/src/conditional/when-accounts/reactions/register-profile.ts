import { defineReaction, invoke, system, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { whenAccounts } from '../condition.ts';

/**
 * A sign-up creates its profile in the same unit, by the accounts action (S-40). Profiles are never
 * looked at first: `accounts.register` decides, so its gate answers the same for every address,
 * and an address that already has a profile fails the unit with `accounts.email_taken`, which
 * is what M1 answers (S-112): a failed invoke effect cannot be remapped to `auth.identifier_taken`
 * until error mapping on `invoke` exists (follow-up on 7.4/7.7).
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
          { as: system('create the profile of a sign-up') },
        ),
      ],
    };
  },
});
