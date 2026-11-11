import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';

/**
 * Whether an earlier attempt of an effect may have reached its destination (D1, reviewer check 14):
 * over the effect's attempt records, the attempts that started (distinct `attempt` values) and the
 * first attempt (up to and including `attempt`) that has a start record and no record carrying
 * `endedAt`. The begin unit calls this before it writes its own start record, so a record with the
 * current number belongs to an earlier take of the same attempt (a release that does not count the
 * attempt hands the job out again under its number). An attempt with no start record did not
 * happen; one with a start and no end may have acted, and the next taker settles the effect
 * `abandoned` instead of running it again. Pure.
 */
export function abandonOnLostLease(
  records: readonly EffectAttemptRecord[],
  attempt: number,
): { readonly started: number; readonly open: number | undefined } {
  const started = new Set<number>();
  const ended = new Set<number>();
  for (const record of records) {
    started.add(record.attempt);
    if (record.endedAt !== undefined) ended.add(record.attempt);
  }
  const open = [...started].sort((a, b) => a - b).find((n) => n <= attempt && !ended.has(n));
  return { started: started.size, open };
}
