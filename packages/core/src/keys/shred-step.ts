import type { KeyService } from '../kernel/key-service.ts';
import type { KeyTombstoneRecord } from '../ledger/key-tombstone-record.ts';
import type { Unit } from '../storage/unit.ts';
import { shredSubject } from './shred-subject.ts';

/** What the shred step is run with. */
export interface ShredStepInput {
  readonly keys: KeyService;
  readonly subjectId: string;
  readonly at: Temporal.Instant;
  /** Test seam: runs after the first statement of the step, to hold one unit while another runs it. */
  readonly afterFirstShred?: () => Promise<void>;
}

/**
 * Step 2 of section 14.7.5 in one writing tenant unit: destroys the subject's data keys and answers
 * a tombstone for each key the subject has that is destroyed, now or before. Every erased subject
 * keeps a shredded key row, one that never had a key included: the fence refuses a row for it from
 * now on, in every process.
 *
 * The ORDER is the lock order. The shred takes the subject's advisory lock before it locks any key
 * row; the creation under that lock follows, and a second shred destroys the key it made. Two
 * units on one subject (two workers, or a worker and the boot replay) queue on the advisory lock
 * instead of each holding a share lock on the key row that the other's update waits for, which
 * ends in a deadlock (40P01). Creating first would take the share lock first.
 */
export async function shredStep(
  unit: Unit,
  input: ShredStepInput,
): Promise<readonly KeyTombstoneRecord[]> {
  const { keys, subjectId, at } = input;
  await shredSubject(unit, keys, subjectId, at);
  await input.afterFirstShred?.();
  await unit.keys.dataKey(subjectId, { create: true });
  return shredSubject(unit, keys, subjectId, at);
}
