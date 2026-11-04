import { defineCommand } from '@keelwerk/core';
import { authBase } from '../base.ts';

/** Revokes the session the caller presented: the typed reference of auth's principal carries its id (decision 92). */
export const logout = defineCommand(authBase, {
  principal: 'user',
  decide: (_input, ctx) => {
    const sessionId = ctx.principal.ref?.sessionId;
    return sessionId === undefined
      ? []
      : [ctx.write.auth.session.update(sessionId, { revokedAt: ctx.clock.now() })];
  },
});
