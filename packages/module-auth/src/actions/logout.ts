import { defineCommand } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { sessionCookieName } from '../lib/session-cookie-name.ts';

/** Revokes the session the caller presented; its id is the principal's credential reference (17.2.3). */
const logoutDef = defineCommand(authBase, {
  principal: 'user',
  execution: 'sync',
  hints: { http: { cookie: { clear: { name: sessionCookieName } } } },
  decide: (_input, ctx) => {
    const sessionId = ctx.principal.ref?.sessionId;
    return sessionId === undefined
      ? []
      : [ctx.write.auth.session.update(sessionId, { revokedAt: ctx.clock.now() })];
  },
});

type LogoutPart = typeof logoutDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Logout extends LogoutPart {}
export const logout: Logout = logoutDef;
