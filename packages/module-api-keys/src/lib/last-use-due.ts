const useIntervalHours = 1;

/** Whether a key's last use is to be recorded again: never recorded, or recorded an hour ago or more (S-140). */
export function lastUseDue(
  lastUsedAt: Temporal.Instant | undefined,
  now: Temporal.Instant,
): boolean {
  return (
    lastUsedAt === undefined ||
    Temporal.Instant.compare(lastUsedAt.add({ hours: useIntervalHours }), now) <= 0
  );
}
