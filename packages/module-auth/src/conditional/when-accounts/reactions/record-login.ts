import { defineReaction, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { whenAccounts } from '../condition.ts';

/**
 * The login time flows back to the profile field auth contributed. Inline in M1, since workers
 * arrive with M2 (S-24).
 */
export const recordLogin = defineReaction(within(authBase, whenAccounts), {
  on: 'auth.session.created',
  timing: 'inline',
  *react(event, ctx) {
    const credential = yield* ctx.load.auth.credential.byId(event.state.credentialId);
    const profileId = credential?.profileId;
    return profileId === undefined
      ? []
      : [ctx.write.accounts.profile.update(profileId, { lastLoginAt: event.at })];
  },
});
