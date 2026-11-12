import { defineRule } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';
import { sessionOnlyReason } from '../../lib/session-only-reason.ts';
import { signedInBySession } from '../../lib/signed-in-by-session.ts';

/** A credential is revoked by a person signed in with a session, never by a key or another credential. */
export const sessionOnly = defineRule(authBase, credential, {
  effect: 'deny',
  actions: ['revoke'],
  principal: 'user',
  where: (ctx) => !signedInBySession(ctx.principal),
  reason: sessionOnlyReason,
});
