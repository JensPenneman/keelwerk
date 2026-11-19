/** A check never comes sooner than this after `now`, so a session whose expiry is past cannot spin. */
const floorMs = 1000;

/**
 * When a long-lived connection checks its session next (16.3.4): `revalidateMs` after `now`, or the
 * session's `expiresAt` when that is sooner, never sooner than one second after `now`, so a session
 * whose expiry is past cannot spin.
 */
export function nextSessionCheckAt(
  now: Temporal.Instant,
  revalidateMs: number,
  expiresAt: Temporal.Instant | undefined,
): Temporal.Instant {
  const periodic = now.add({ milliseconds: revalidateMs });
  const wanted =
    expiresAt !== undefined && Temporal.Instant.compare(expiresAt, periodic) < 0
      ? expiresAt
      : periodic;
  const floor = now.add({ milliseconds: floorMs });
  return Temporal.Instant.compare(wanted, floor) < 0 ? floor : wanted;
}
