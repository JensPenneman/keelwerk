import {
  defineFill,
  errors,
  type Id,
  type Principal,
  type PrincipalResolution,
  setTimer,
  within,
} from '@keelwerk/core';
import { extendSession } from '../../../actions/extend-session.ts';
import { authBase } from '../../../base.ts';
import { extensionIntervalMinutes } from '../../../lib/extension-interval-minutes.ts';
import { idleExpiry } from '../../../lib/idle-expiry.ts';
import { isLiveSession } from '../../../lib/is-live-session.ts';
import { parseSessionToken } from '../../../lib/parse-session-token.ts';
import { presentedToken } from '../../../lib/presented-token.ts';
import { principalOfSession } from '../../../lib/principal-of-session.ts';
import { sessionCacheKey } from '../../../lib/session-cache-key.ts';
import { sessionCookieName } from '../../../lib/session-cookie-name.ts';
import { sessionExtensionKey } from '../../../lib/session-extension-key.ts';
import { sessionRefCacheKey } from '../../../lib/session-ref-cache-key.ts';
import { sessionResolverId } from '../../../lib/session-resolver-id.ts';
import { toCore } from '../contribution.ts';

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
      if (!verified || credential === undefined || !isLiveSession(row, credential, now)) {
        return stale();
      }
      const principal = principalOfSession(row, credential, scope);
      const due = now.subtract({ minutes: extensionIntervalMinutes });
      const extending = Temporal.Instant.compare(row.lastSeenAt, due) < 0;
      return {
        principal,
        ...(extending
          ? {
              effects: [
                // A timer runs as the module's service principal, so the job judges the session itself.
                setTimer({
                  key: sessionExtensionKey(row.id),
                  invoke: extendSession,
                  input: { sessionId: row.id, seenAt: now },
                  at: now,
                }),
              ],
              // The extension slides the idle expiry, so a cookie is set again with the expiry it will have (S-110).
              ...(presented.source === 'cookie'
                ? {
                    renewCookie: {
                      name: sessionCookieName,
                      value: presented.token,
                      expiresAt: idleExpiry(
                        now,
                        row.absoluteExpiresAt,
                        own.config.sessionIdleMinutes,
                      ),
                    },
                  }
                : {}),
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
    // Queued work, a redeemed ticket and an open stream hold no token: the reference alone is judged, so
    // a revoked session or credential and an expired session stop there (S-122). The sessions bind no
    // transport, so the transport is not looked at, and nothing is extended.
    *fromRef(ref, { scope, clock }) {
      const row = yield* own.load.auth.session.byId(ref.principalId as Id<'auth.session'>);
      if (row === undefined || Reflect.get(ref, 'credentialId') !== row.credentialId) return null;
      const credential = yield* own.load.auth.credential.byId(row.credentialId);
      if (credential === undefined || !isLiveSession(row, credential, clock.now())) return null;
      return {
        principal: principalOfSession(row, credential, scope),
        cache: {
          key: sessionRefCacheKey(row.id),
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
