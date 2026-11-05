import {
  defineFill,
  enqueue,
  errors,
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
import { toCore } from '../contribution.ts';

const resolverId = 'auth.session';

/** The session resolver of 17.2.4: a cookie or a bearer token to a user principal, or to nothing. */
export const principalResolversFill = defineFill(
  within(authBase, toCore),
  'principalResolvers',
  (own) => [
    {
      id: resolverId,
      describe: () => ({ scheme: 'cookie', name: sessionCookieName }),
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
            via: resolverId,
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
        const ref = {
          resolver: resolverId,
          principalId: row.id,
          credentialId: row.credentialId,
          sessionId: row.id,
        };
        const principal: Principal = {
          kind: 'user',
          subject: row.subject,
          subjectRef: null,
          subjectAs: () => null,
          scope: where,
          claims: {},
          roles: [],
          memberships: [],
          via: resolverId,
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
  ],
);
