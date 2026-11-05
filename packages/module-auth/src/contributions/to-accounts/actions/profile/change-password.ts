import { defineCommand, errors, field, shape, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { session } from '../../../../entities/session.ts';
import { invalidCredentials } from '../../../../errors/invalid-credentials.ts';
import { reauthenticationRequired } from '../../../../errors/reauthentication-required.ts';
import { tooManyRecords } from '../../../../errors/too-many-records.ts';
import { isRecentlyAuthenticated } from '../../../../lib/is-recently-authenticated.ts';
import { retireResetTokens } from '../../../../lib/retire-reset-tokens.ts';
import { revokeOtherSessions } from '../../../../lib/revoke-other-sessions.ts';
import { sessionCookieName } from '../../../../lib/session-cookie-name.ts';
import { sessionExpiry } from '../../../../lib/session-expiry.ts';
import { sessionTokenPrefix } from '../../../../lib/session-token-prefix.ts';
import { verifierOrDummy } from '../../../../lib/verifier-or-dummy.ts';
import { toAccounts } from '../../contribution.ts';

const saltBytes = 16;

/**
 * Replaces the caller's password. It needs the current password or a session authenticated within
 * `reauthenticateWithinMinutes` (17.2.5); a current password that is given must be right. Every
 * other session of the subject is revoked, the current one is rotated into a new session whose
 * token is shown once (17.2.3, S-97), the other open reset links of the credential are retired,
 * and the old verifier's key is destroyed when the new one is sealed.
 */
export const changePassword = defineCommand(within(authBase, toAccounts), 'profile', {
  input: shape({ currentPassword: field.secret().optional(), newPassword: field.secret() }),
  output: shape({
    sessionToken: field.string().optional(),
    sessionId: field.ref(authBase, 'session').optional(),
    expiresAt: field.instant().optional(),
  }),
  shownOnce: ['sessionToken'],
  hints: {
    http: {
      cookie: {
        set: { name: sessionCookieName, from: 'sessionToken', expiresFrom: 'expiresAt' },
        omitFromBody: ['sessionToken'],
      },
    },
  },
  principal: 'user',
  errors: [invalidCredentials, reauthenticationRequired, tooManyRecords],
  execution: 'sync',
  *decide(input, _current, ctx) {
    const recent = yield* isRecentlyAuthenticated(ctx);
    const found = yield* ctx.load.auth.credential.one({
      where: { subject: ctx.principal.subject, kind: 'password', revokedAt: { isNull: true } },
    });
    if (input.currentPassword !== undefined) {
      const right = yield* ctx.compute.argon2idVerify(
        verifierOrDummy(found?.verifier),
        input.currentPassword,
      );
      if (!right) throw invalidCredentials();
    } else if (!recent) {
      throw reauthenticationRequired();
    }
    if (found === undefined) throw errors.not_found('This profile has no password to change.');
    const verifier = yield* ctx.compute.argon2idHash(
      input.newPassword,
      yield* ctx.random(saltBytes),
    );
    const previous = ctx.principal.ref?.sessionId;
    const drafts = [
      ctx.write.auth.credential.update(found, { verifier }),
      ...(yield* retireResetTokens(ctx, found.id, undefined)),
      ...(yield* revokeOtherSessions(ctx, ctx.principal.subject, undefined)),
    ];
    if (previous === undefined) return { events: drafts, result: {} };
    const now = ctx.clock.now();
    const id = yield* ctx.newId(session);
    const token = yield* ctx.secrets.issue({ prefix: sessionTokenPrefix });
    const { idleExpiresAt, absoluteExpiresAt } = sessionExpiry(now, ctx.config);
    const userAgent = ctx.request.userAgent;
    const address = ctx.request.connection?.remote.address;
    return {
      events: [
        ...drafts,
        ctx.write.auth.session.create({
          id,
          subject: ctx.principal.subject,
          credentialId: found.id,
          publicId: token.publicId,
          tokenVerifier: token.verifier,
          authenticatedAt: now,
          lastSeenAt: now,
          idleExpiresAt,
          absoluteExpiresAt,
          rotatedFrom: previous,
          ...(userAgent === undefined ? {} : { userAgent }),
          ...(address === undefined ? {} : { address }),
        }),
      ],
      result: { sessionToken: token.plain, sessionId: id, expiresAt: idleExpiresAt },
    };
  },
});
