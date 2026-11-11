import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';
import type { Unit } from '../storage/unit.ts';

/** The records one read takes. */
const pageSize = 200;

function attemptRecordOf(data: unknown): EffectAttemptRecord | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const attempt: unknown = Reflect.get(data, 'attempt');
  return typeof attempt === 'number' ? (data as EffectAttemptRecord) : undefined;
}

/**
 * The latest `bound` attempt records of an effect, in order, and the attempts that started (the
 * distinct attempt numbers of all its records). The stream has no read from its tail, so the
 * records are read forward in pages by sequence number and only the latest `bound` are kept: the
 * records that matter (an attempt left open) are the most recent ones, and a stream longer than one
 * page is never cut short at its head.
 */
export async function latestAttemptRecords(
  unit: Unit,
  effectId: string,
  bound: number,
  page: number = pageSize,
): Promise<{
  readonly records: readonly EffectAttemptRecord[];
  readonly started: ReadonlySet<number>;
}> {
  const latest: EffectAttemptRecord[] = [];
  const started = new Set<number>();
  let after: bigint | null = null;
  for (;;) {
    const read = await unit.streams.read('core.effectAttempt', effectId, after, page);
    for (const stored of read) {
      const record = attemptRecordOf(stored.data);
      if (record === undefined) continue;
      started.add(record.attempt);
      latest.push(record);
      if (latest.length > bound) latest.shift();
    }
    const last = read.at(-1);
    if (last === undefined || read.length < page) break;
    after = last.seq;
  }
  return { records: latest, started };
}
