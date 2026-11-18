/** Not revoked, its credential present and not revoked, and both expiries after `now` (17.2.3). */
export function isLiveSession(
  row: {
    readonly revokedAt?: Temporal.Instant | undefined;
    readonly idleExpiresAt: Temporal.Instant;
    readonly absoluteExpiresAt: Temporal.Instant;
  },
  credential: { readonly revokedAt?: Temporal.Instant | undefined } | undefined,
  now: Temporal.Instant,
): boolean {
  return (
    credential !== undefined &&
    credential.revokedAt === undefined &&
    row.revokedAt === undefined &&
    Temporal.Instant.compare(row.idleExpiresAt, now) > 0 &&
    Temporal.Instant.compare(row.absoluteExpiresAt, now) > 0
  );
}
