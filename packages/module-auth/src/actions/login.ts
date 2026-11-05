import { defineCommand, field, needsRehash, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { session } from '../entities/session.ts';
import { invalidCredentials } from '../errors/invalid-credentials.ts';
import { sessionCookieName } from '../lib/session-cookie-name.ts';
import { sessionExpiry } from '../lib/session-expiry.ts';
import { sessionTokenPrefix } from '../lib/session-token-prefix.ts';
import { verifierOrDummy } from '../lib/verifier-or-dummy.ts';

const saltBytes = 16;

/**
 * Checks a password and opens a session. The token is shown once: the receipt never keeps it
 * (S-97). An unknown identifier is verified against a dummy hash at the same cost (17.2.2).
 */
const loginDef = defineCommand(authBase, {
  input: shape({ identifier: field.string({ format: 'email' }), password: field.secret() }),
  output: shape({
    sessionToken: field.string(),
    sessionId: field.ref.own('session'),
    expiresAt: field.instant(),
  }),
  shownOnce: ['sessionToken'],
  errors: [invalidCredentials],
  auth: { public: true },
  execution: 'sync',
  hints: {
    http: {
      cookie: {
        set: { name: sessionCookieName, from: 'sessionToken', expiresFrom: 'expiresAt' },
        omitFromBody: ['sessionToken'],
      },
    },
    cli: { login: { tokenField: 'sessionToken' } },
  },
  *decide(input, ctx) {
    const found = yield* ctx.load.auth.credential.one({
      where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } },
    });
    const ok = yield* ctx.compute.argon2idVerify(verifierOrDummy(found?.verifier), input.password);
    if (found === undefined || !ok) throw invalidCredentials();
    const rehashed = needsRehash(found.verifier)
      ? yield* ctx.compute.argon2idHash(input.password, yield* ctx.random(saltBytes))
      : undefined;
    const now = ctx.clock.now();
    const id = yield* ctx.newId(session);
    const token = yield* ctx.secrets.issue({ prefix: sessionTokenPrefix });
    const { idleExpiresAt, absoluteExpiresAt } = sessionExpiry(now, ctx.config);
    const userAgent = ctx.request.userAgent;
    const address = ctx.request.connection?.remote.address;
    return {
      events: [
        ctx.write.auth.session.create({
          id,
          subject: found.subject,
          credentialId: found.id,
          publicId: token.publicId,
          tokenVerifier: token.verifier,
          authenticatedAt: now,
          lastSeenAt: now,
          idleExpiresAt,
          absoluteExpiresAt,
          ...(userAgent === undefined ? {} : { userAgent }),
          ...(address === undefined ? {} : { address }),
        }),
        ctx.write.auth.credential.update(found, {
          lastUsedAt: now,
          ...(rehashed === undefined ? {} : { verifier: rehashed }),
        }),
      ],
      result: { sessionToken: token.plain, sessionId: id, expiresAt: idleExpiresAt },
    };
  },
});

type LoginPart = typeof loginDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Login extends LoginPart {}
export const login: Login = loginDef;
