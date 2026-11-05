/** The idle expiry after activity at `now`: a full idle period, capped by the absolute expiry. */
export function idleExpiry(
  now: Temporal.Instant,
  absoluteExpiresAt: Temporal.Instant,
  idleMinutes: number,
): Temporal.Instant {
  const idle = now.add({ minutes: idleMinutes });
  return Temporal.Instant.compare(idle, absoluteExpiresAt) < 0 ? idle : absoluteExpiresAt;
}
