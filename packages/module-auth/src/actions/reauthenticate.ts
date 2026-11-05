import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { invalidCredentials } from '../errors/invalid-credentials.ts';
import { verifierOrDummy } from '../lib/verifier-or-dummy.ts';

/**
 * Confirms the caller's password and refreshes `authenticatedAt` of the session, so a credential
 * change within the configured window needs no password again (17.2.5).
 */
const reauthenticateDef = defineCommand(authBase, {
  input: shape({ password: field.secret() }),
  output: shape({ authenticatedAt: field.instant() }),
  principal: 'user',
  errors: [invalidCredentials],
  execution: 'sync',
  *decide(input, ctx) {
    const sessionId = ctx.principal.ref?.sessionId;
    const current =
      sessionId === undefined ? undefined : yield* ctx.load.auth.session.byId(sessionId);
    const found = yield* ctx.load.auth.credential.one({
      where: { subject: ctx.principal.subject, kind: 'password', revokedAt: { isNull: true } },
    });
    const ok = yield* ctx.compute.argon2idVerify(verifierOrDummy(found?.verifier), input.password);
    if (current === undefined || found === undefined || !ok) throw invalidCredentials();
    const now = ctx.clock.now();
    return {
      events: [ctx.write.auth.session.update(current, { authenticatedAt: now })],
      result: { authenticatedAt: now },
    };
  },
});

type ReauthenticatePart = typeof reauthenticateDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Reauthenticate extends ReauthenticatePart {}
export const reauthenticate: Reauthenticate = reauthenticateDef;
