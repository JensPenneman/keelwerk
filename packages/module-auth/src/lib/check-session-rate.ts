import { type DecideContext, errors, type Gen, type Id } from '@keelwerk/core';
import type { AuthBase } from '../base.ts';

type Own = DecideContext<AuthBase>;
type RateContext = Pick<Own, 'clock' | 'config'> & {
  readonly load: { readonly auth: Own['load']['auth'] };
};

const windowSeconds = 60;
const millisPerSecond = 1000;

/**
 * Refuses a step that writes the credential when the credential already opened
 * `successfulLoginsPerMinute` sessions in the last minute (17.2.6). The count is of the sessions
 * whose `authenticatedAt` is in that minute: every login opens one, so does the rotation of a
 * password change, and a reauthentication of a session sets its `authenticatedAt` to now, so it
 * counts like a login. The three share the cap, and only a person who holds the password can use
 * it up. It is called only after the password was verified, so a caller who does not know the
 * password never uses it up and learns nothing from it, and before anything is drafted, so a
 * refused step appends nothing. The count is read inside the unit that appends to the credential's
 * stream: a concurrent step that commits first moves the stream's version, the unit repeats, and
 * the count is read again, so no burst passes the cap.
 */
export function* checkSessionRate(
  ctx: RateContext,
  credential: { readonly id: Id<'auth.credential'> },
): Gen<void> {
  const cap = ctx.config.successfulLoginsPerMinute;
  const now = ctx.clock.now();
  const recent = yield* ctx.load.auth.session.many({
    where: {
      credentialId: credential.id,
      authenticatedAt: { gt: now.subtract({ seconds: windowSeconds }) },
    },
    sort: [{ field: 'authenticatedAt', direction: 'asc' }],
    limit: cap,
  });
  const oldest = recent[0];
  if (recent.length < cap || oldest === undefined) return;
  const free = oldest.authenticatedAt.add({ seconds: windowSeconds }).epochMilliseconds;
  throw errors.rate_limited('Too many requests.', {
    retryAfter: Math.max(1, Math.ceil((free - now.epochMilliseconds) / millisPerSecond)),
  });
}
