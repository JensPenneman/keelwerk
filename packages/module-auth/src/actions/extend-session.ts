import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { idleExpiry } from '../lib/idle-expiry.ts';
import { isLiveSession } from '../lib/is-live-session.ts';

/**
 * The idle extension the session resolver sets as a timer, keyed by session so that concurrent
 * requests coalesce (17.2.3, S-24). The job runs as the module's own service principal with the
 * session in its input, so a session that was revoked or expired, or whose credential was revoked,
 * before the job ran is no failure: the job judges the session itself (`isLiveSession`) and then
 * decides nothing. It extends from the instant of the request (`seenAt`), never from the time the
 * job runs: a worker that is late must not grant more idle time than the policy does, and a job
 * whose request was not stamped (the rows a 0.1.0 deployment left behind, which run as the user of
 * the session) decides nothing. It never moves `lastSeenAt` or `idleExpiresAt` backwards. A user
 * who calls it extends only the session they hold.
 */
const extendSessionDef = defineCommand(authBase, {
  input: shape({ sessionId: field.ref.own('session'), seenAt: field.instant().optional() }),
  principal: ['user', 'service'],
  execution: 'sync',
  *decide(input, ctx) {
    if (input.seenAt === undefined) return [];
    if (ctx.principal.kind === 'user' && ctx.principal.ref?.sessionId !== input.sessionId) {
      return [];
    }
    const current = yield* ctx.load.auth.session.byId(input.sessionId);
    if (current === undefined) return [];
    const credential = yield* ctx.load.auth.credential.byId(current.credentialId);
    const now = ctx.clock.now();
    if (!isLiveSession(current, credential, now)) return [];
    const seen = Temporal.Instant.compare(input.seenAt, now) < 0 ? input.seenAt : now;
    if (Temporal.Instant.compare(seen, current.lastSeenAt) <= 0) return [];
    const extended = idleExpiry(seen, current.absoluteExpiresAt, ctx.config.sessionIdleMinutes);
    return [
      ctx.write.auth.session.update(current, {
        lastSeenAt: seen,
        idleExpiresAt:
          Temporal.Instant.compare(extended, current.idleExpiresAt) > 0
            ? extended
            : current.idleExpiresAt,
      }),
    ];
  },
});

type ExtendSessionPart = typeof extendSessionDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface ExtendSession extends ExtendSessionPart {}
export const extendSession: ExtendSession = extendSessionDef;
