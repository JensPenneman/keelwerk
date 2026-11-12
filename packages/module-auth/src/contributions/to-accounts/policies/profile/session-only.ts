import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { sessionOnlyReason } from '../../../../lib/session-only-reason.ts';
import { signedInBySession } from '../../../../lib/signed-in-by-session.ts';
import { toAccounts } from '../../contribution.ts';

/** The password of a profile changes only for a person signed in with a session, never for a key. */
export const sessionOnly = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'deny',
  actions: ['changePassword'],
  principal: 'user',
  where: (ctx) => !signedInBySession(ctx.principal),
  reason: sessionOnlyReason,
});
