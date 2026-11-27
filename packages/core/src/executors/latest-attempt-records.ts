import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';
import type { Unit } from '../storage/unit.ts';
import { attemptRecordBound } from './attempt-record-bound.ts';

function attemptRecordOf(data: unknown): EffectAttemptRecord | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const attempt: unknown = Reflect.get(data, 'attempt');
  return typeof attempt === 'number' ? (data as EffectAttemptRecord) : undefined;
}

/**
 * The latest `attemptRecordBound` attempt records of an effect, in order, from one read of the
 * stream's tail, and `attempts`: the highest attempt number among them, which is the job's attempt
 * counter at the last take that started (a number spent with no start record is not counted). The
 * records that matter (an attempt left open) are the most recent ones.
 */
export async function latestAttemptRecords(
  unit: Unit,
  effectId: string,
): Promise<{
  readonly records: readonly EffectAttemptRecord[];
  readonly attempts: number;
}> {
  const stored = await unit.streams.readLast('core.effectAttempt', effectId, attemptRecordBound);
  const records = stored.flatMap((record) => attemptRecordOf(record.data) ?? []);
  return { records, attempts: Math.max(0, ...records.map((record) => record.attempt)) };
}
