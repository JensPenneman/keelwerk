import { defineRule } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { session } from '../../entities/session.ts';
import { sessionOnlyReason } from '../../lib/session-only-reason.ts';
import { signedInBySession } from '../../lib/signed-in-by-session.ts';

/** A session is revoked by a person signed in with a session, never by a key or another credential. */
export const sessionOnly = defineRule(authBase, session, {
  effect: 'deny',
  actions: ['revoke'],
  principal: 'user',
  where: (ctx) => !signedInBySession(ctx.principal),
  reason: sessionOnlyReason,
});
