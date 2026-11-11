import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { appendStreamRecords } from '../write-path/append-stream-records.ts';

/**
 * Appends one record to the stream `core.effectAttempt` keyed by the effect id (7.9.6, D1), in the
 * unit the caller holds and under the authority of the core, so it commits or rolls back with the
 * unit's other writes. A started attempt writes two: the start record before `run` is called and
 * the end record when the attempt retries or settles.
 */
export function recordAttempt(
  unit: Unit,
  registry: Registry,
  effectId: string,
  record: EffectAttemptRecord,
): Promise<void> {
  return appendStreamRecords({
    registry,
    unit,
    authority: 'core',
    appends: [
      {
        kind: 'append',
        type: 'append',
        target: 'core.effectAttempt',
        stream: 'core.effectAttempt',
        key: effectId,
        records: [record],
      },
    ],
  });
}
