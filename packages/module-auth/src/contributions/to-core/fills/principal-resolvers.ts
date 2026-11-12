import {
  defineFill,
  enqueue,
  errors,
  type Id,
  type Principal,
  type PrincipalResolution,
  within,
} from '@keelwerk/core';
import { extendSession } from '../../../actions/extend-session.ts';
import { authBase } from '../../../base.ts';
import { extensionIntervalMinutes } from '../../../lib/extension-interval-minutes.ts';
import { parseSessionToken } from '../../../lib/parse-session-token.ts';
import { presentedToken } from '../../../lib/presented-token.ts';
import { sessionCacheKey } from '../../../lib/session-cache-key.ts';
import { sessionCookieName } from '../../../lib/session-cookie-name.ts';
import { sessionResolverId } from '../../../lib/session-resolver-id.ts';
import { toCore } from '../contribution.ts';

const profileSubjectRef = 'accounts.profile';

const sessionScheme = { scheme: 'cookie', name: sessionCookieName } as const;

/** The session resolver of 17.2.4: a cookie or a bearer token to a user principal, or to nothing. */
const sessionResolverFill = defineFill(within(authBase, toCore), 'principalResolvers', (own) => [
  {
    id: sessionResolverId,
    describe: () => sessionScheme,
    *resolve(carrier, { scope, clock }) {
      const presented = presentedToken(carrier);
      if (presented === undefined) return null;
      const parsed = parseSessionToken(presented.token);
      if (parsed.kind === 'foreign') return null;
      const where = {
        backend: scope.level === 'deployment' ? null : scope.backendId,
        tenant: scope.level === 'tenant' ? scope.tenantId : null,
      };
      // A stale cookie makes the request anonymous and clears the cookie; an invalid bearer token fails (17.2.4).
      const stale = (): PrincipalResolution => {
        if (presented.source === 'bearer') {
          throw errors.unauthenticated('The session token was not accepted.');
        }
        const anonymous: Principal = {
          kind: 'anonymous',
          scope: where,
          claims: {},
          roles: [],
          memberships: [],
          via: sessionResolverId,
          ref: null,
        };
        return { principal: anonymous, clearCookies: [sessionCookieName] };
      };
      // A bearer token in another format is for another resolver; the kernel answers unauthenticated when none accepts it.
      if (parsed.kind === 'malformed') return presented.source === 'bearer' ? null : stale();
      const row = yield* own.load.auth.session.one({ where: { publicId: parsed.publicId } });
      if (row === undefined) return stale();
      const verified = yield* own.secrets.verify(presented.token, row.tokenVerifier);
      const now = clock.now();
      const credential = yield* own.load.auth.credential.byId(row.credentialId);
      if (
        !verified ||
        credential === undefined ||
        credential.revokedAt !== undefined ||
        row.revokedAt !== undefined ||
        Temporal.Instant.compare(row.idleExpiresAt, now) <= 0 ||
        Temporal.Instant.compare(row.absoluteExpiresAt, now) <= 0
      ) {
        return stale();
      }
      // With accounts selected the credential holds the profile it belongs to, and the subject is its id (17.2.1).
      const profileId: string | undefined = Reflect.get(credential, 'profileId');
      const ref = {
        resolver: sessionResolverId,
        principalId: row.id,
        credentialId: row.credentialId,
        sessionId: row.id,
      };
      const principal: Principal = {
        kind: 'user',
        subject: row.subject,
        subjectRef: profileId === undefined ? null : profileSubjectRef,
        subjectAs: <R extends string>(ref: R) =>
          profileId !== undefined && ref === profileSubjectRef ? (profileId as Id<R>) : null,
        scope: where,
        claims: {},
        roles: [],
        memberships: [],
        via: sessionResolverId,
        ref,
        expiresAt:
          Temporal.Instant.compare(row.idleExpiresAt, row.absoluteExpiresAt) < 0
            ? row.idleExpiresAt
            : row.absoluteExpiresAt,
      };
      const due = now.subtract({ minutes: extensionIntervalMinutes });
      return {
        principal,
        ...(Temporal.Instant.compare(row.lastSeenAt, due) < 0
          ? {
              effects: [
                enqueue(extendSession, { sessionId: row.id }, { key: `auth.extend:${row.id}` }),
              ],
            }
          : {}),
        cache: {
          key: sessionCacheKey(presented.token),
          drops: [
            { entity: 'auth.session', id: row.id },
            { entity: 'auth.credential', id: row.credentialId },
          ],
        },
      };
    },
  },
]);

/**
 * The same fill with `describe` beside its factory: the resolvers it yields as the security
 * schemes describe them, so a surface derived without a runtime needs no bound context (16.2).
 */
export const principalResolversFill: typeof sessionResolverFill = {
  ...sessionResolverFill,
  factory: Object.assign(sessionResolverFill.factory, {
    describe: () => [{ id: sessionResolverId, ...sessionScheme }],
  }),
};
