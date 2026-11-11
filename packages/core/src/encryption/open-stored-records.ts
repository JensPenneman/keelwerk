import type { StreamRecord } from '../storage/stream-record.ts';
import type { Unit } from '../storage/unit.ts';
import type { OpenStreamRecordsInput } from './open-stream-records.ts';
import { personalSealerOf } from './personal-sealer-of.ts';

/** Records as handlers and clients read them: opened on a sealing unit, as stored on any other. */
export function openStoredRecords(
  unit: Unit,
  input: OpenStreamRecordsInput,
): Promise<readonly StreamRecord[]> {
  const sealer = personalSealerOf(unit);
  return sealer === undefined ? Promise.resolve(input.records) : sealer.openRecords(input);
}
