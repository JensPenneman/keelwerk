import { defineRule } from '@keelwerk/core';
import { reauthenticate } from '../../actions/reauthenticate.ts';
import { authBase } from '../../base.ts';
import { sessionOnlyReason } from '../../lib/session-only-reason.ts';
import { signedInBySession } from '../../lib/signed-in-by-session.ts';

export const sessionOnly = defineRule(authBase, reauthenticate, {
  effect: 'deny',
  principal: 'user',
  when: (ctx) => !signedInBySession(ctx.principal),
  reason: sessionOnlyReason,
});
