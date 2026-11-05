import type { DecideContext, Gen } from '@keelwerk/core';
import type { AuthBase } from '../base.ts';

type Own = DecideContext<AuthBase>;
type RecentContext = Pick<Own, 'clock' | 'config' | 'principal'> & {
  readonly load: { readonly auth: Own['load']['auth'] };
};

/**
 * Whether the caller's session was authenticated within `reauthenticateWithinMinutes` (17.2.5). A
 * caller without a session (an API key, an operator) never counts as recently authenticated.
 */
export function* isRecentlyAuthenticated(ctx: RecentContext): Gen<boolean> {
  const sessionId = ctx.principal.ref?.sessionId;
  if (sessionId === undefined) return false;
  const current = yield* ctx.load.auth.session.byId(sessionId);
  if (current === undefined || current.revokedAt !== undefined) return false;
  const since = ctx.clock.now().subtract({ minutes: ctx.config.reauthenticateWithinMinutes });
  return Temporal.Instant.compare(current.authenticatedAt, since) >= 0;
}
