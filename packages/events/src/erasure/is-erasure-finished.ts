import type {
  ErasureCompletedRecord,
  ErasureRecord,
  RuntimeServiceContext,
  Scope,
} from '@keelwerk/core';
import type { ErasureTarget } from './erasure-target.ts';

/**
 * Whether the steps 2 to 6 of an erasure are finished in its tenant (section 14.7.5), from the
 * completions that stand after its record in the control ledger. Both must hold:
 * (a) a completion of the CURRENT epoch of the tenant scope exists (a restore moves the epoch, and
 * the completion of an earlier one says nothing about the restored placement), and
 * (b) no data key of the subject was destroyed AFTER the latest such completion: a later
 * `shredded_at` proves that the boot key replay destroyed a key that a restore had brought back,
 * which is the restore signal until the epoch is bumped at every detected restore. A backup taken
 * between the shred and the completion is not detected yet (the window the epoch closes).
 */
export async function isErasureFinished(
  context: RuntimeServiceContext,
  found: ErasureTarget,
  record: ErasureRecord,
  completions: readonly ErasureCompletedRecord[],
  epochOf?: (scope: Scope) => number,
): Promise<boolean> {
  const { target } = found;
  const epoch = epochOf?.(target.scope) ?? context.control.epochOf(target.scope);
  const current = completions.filter((completion) => completion.epoch === epoch);
  if (current.length === 0) return false;
  const latest = current
    .map((completion) => Temporal.Instant.from(completion.recordedAt))
    .reduce((a, b) => (Temporal.Instant.compare(a, b) >= 0 ? a : b));
  const shredded = await target.handle.adapter.unit(
    target.namespace,
    target.scope,
    (unit) => unit.keys.shreddedKeys(record.subjectId),
    { readOnly: true },
  );
  return !shredded.some((key) => Temporal.Instant.compare(key.shreddedAt, latest) > 0);
}
