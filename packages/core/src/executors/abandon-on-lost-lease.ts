import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';

/**
 * Whether an earlier attempt of an effect may have reached its destination (D1, reviewer check 14):
 * over the effect's attempt records, the attempts that started (distinct `attempt` values) and the
 * first attempt (up to and including `attempt`) that has a take (a start record) with no end record
 * of its own. A take is told by attempt, process and start instant, and an end record carries those
 * of its start: a release that does not count the attempt hands the job out again under its number,
 * so the end of an earlier take never closes a later one. The begin unit calls this before it writes
 * its own start record, so a record with the current number belongs to an earlier take. An attempt
 * with no start record did not happen; a take with a start and no end may have acted, and the next
 * taker settles the effect `abandoned` instead of running it again. Pure.
 */
export function abandonOnLostLease(
  records: readonly EffectAttemptRecord[],
  attempt: number,
): { readonly started: number; readonly open: number | undefined } {
  const started = new Set<number>();
  const ended = new Set<string>();
  const takeOf = (record: EffectAttemptRecord): string =>
    JSON.stringify([record.attempt, record.process, record.startedAt]);
  for (const record of records) {
    started.add(record.attempt);
    if (record.endedAt !== undefined) ended.add(takeOf(record));
  }
  const open = records
    .filter((record) => record.attempt <= attempt && !ended.has(takeOf(record)))
    .map((record) => record.attempt)
    .sort((a, b) => a - b)[0];
  return { started: started.size, open };
}
