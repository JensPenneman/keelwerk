import { defineReaction, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { whenAccounts } from '../condition.ts';

/**
 * The login time flows back to the profile field auth contributed, in a job queued from the
 * credential's `loggedIn` event (7.7). The session cannot be the cause: it is a `history: 'state'`
 * entity, so its records are transient and reach inline reactions only. The write is guarded: a
 * job writes only when the profile has no login time yet or an earlier one, and it writes the
 * profile it loaded, so its version decides between two jobs that run at once. Jobs of two logins
 * may run in either order and the newer time stays.
 */
export const recordLogin = defineReaction(within(authBase, whenAccounts), {
  on: 'auth.credential.loggedIn',
  timing: 'async',
  *react(event, ctx) {
    const profileId = event.current?.profileId;
    if (profileId === undefined) return [];
    const profile = yield* ctx.load.accounts.profile.byId(profileId);
    if (profile === undefined) return [];
    if (
      profile.lastLoginAt !== undefined &&
      Temporal.Instant.compare(profile.lastLoginAt, event.data.at) >= 0
    ) {
      return [];
    }
    return [ctx.write.accounts.profile.update(profile, { lastLoginAt: event.data.at })];
  },
});
