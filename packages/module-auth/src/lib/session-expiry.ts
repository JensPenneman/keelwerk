import { idleExpiry } from './idle-expiry.ts';

const hoursPerDay = 24;

/** The two expiry instants of a session. */
export interface SessionExpiry {
  readonly idleExpiresAt: Temporal.Instant;
  readonly absoluteExpiresAt: Temporal.Instant;
}

/** What a new session lasts: idle minutes from now, absolute days from now, the idle never past the absolute (17.2.3). */
export function sessionExpiry(
  now: Temporal.Instant,
  limits: { readonly sessionIdleMinutes: number; readonly sessionAbsoluteDays: number },
): SessionExpiry {
  const absoluteExpiresAt = now.add({ hours: hoursPerDay * limits.sessionAbsoluteDays });
  return {
    idleExpiresAt: idleExpiry(now, absoluteExpiresAt, limits.sessionIdleMinutes),
    absoluteExpiresAt,
  };
}
