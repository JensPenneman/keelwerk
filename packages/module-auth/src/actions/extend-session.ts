import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { idleExpiry } from '../lib/idle-expiry.ts';

/**
 * The idle extension the session resolver enqueues, keyed by session so that concurrent requests
 * coalesce (17.2.3, S-24). It extends only the caller's own live session.
 */
const extendSessionDef = defineCommand(authBase, {
  input: shape({ sessionId: field.ref.own('session') }),
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    if (ctx.principal.ref?.sessionId !== input.sessionId) return [];
    const current = yield* ctx.load.auth.session.byId(input.sessionId);
    const now = ctx.clock.now();
    if (
      current === undefined ||
      current.revokedAt !== undefined ||
      Temporal.Instant.compare(current.absoluteExpiresAt, now) <= 0
    ) {
      return [];
    }
    return [
      ctx.write.auth.session.update(current, {
        lastSeenAt: now,
        idleExpiresAt: idleExpiry(now, current.absoluteExpiresAt, ctx.config.sessionIdleMinutes),
      }),
    ];
  },
});

type ExtendSessionPart = typeof extendSessionDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface ExtendSession extends ExtendSessionPart {}
export const extendSession: ExtendSession = extendSessionDef;
