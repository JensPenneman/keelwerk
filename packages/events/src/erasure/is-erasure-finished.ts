import type { ErasureCompletedRecord, ErasureRecord, RuntimeServiceContext } from '@keelwerk/core';
import { canonicalSubject } from '@keelwerk/core';
import type { ErasureTarget } from './erasure-target.ts';

const ledgerPage = 500;

/** The completions of the erasure that stand after its record (`seq`) in the control ledger, in ledger order: one indexed lookup. */
async function completionsAfter(
  context: RuntimeServiceContext,
  record: ErasureRecord,
  seq: bigint,
): Promise<readonly ErasureCompletedRecord[]> {
  const found: ErasureCompletedRecord[] = [];
  let after = seq;
  for (;;) {
    const page = await context.control.ledger.find(
      [
        {
          type: 'erasureCompleted',
          tenantId: record.tenantId,
          commandId: record.commandId,
          subjectId: canonicalSubject(record.subjectId),
        },
      ],
      { after, limit: ledgerPage },
    );
    for (const entry of page) {
      after = entry.seq;
      if (entry.record.type === 'erasureCompleted') found.push(entry.record);
    }
    if (page.length < ledgerPage) return found;
  }
}

/**
 * Whether the steps 2 to 6 of an erasure are finished in its tenant (section 14.7.5), from the
 * completions that stand after its record (`seq`) in the control ledger. Both must hold:
 * (a) a completion of the CURRENT epoch of the tenant scope exists (a restore moves the epoch at
 * `connect`, and the completion of an earlier one says nothing about the restored placement), and
 * (b) no data key of the subject was destroyed AFTER the latest such completion: a later
 * `shredded_at` proves that the key replay destroyed a key that a restore had brought back, which
 * covers a restore the epoch did not detect.
 */
export async function isErasureFinished(
  context: RuntimeServiceContext,
  found: ErasureTarget,
  record: ErasureRecord,
  seq: bigint,
): Promise<boolean> {
  const { target } = found;
  const epoch = context.control.epochOf(target.scope);
  // A second copy of the record, appended after the erasure completed (an attempt that outlived
  // its lease), is the same erasure: the completions count from the first copy.
  const [first] = await context.control.ledger.find(
    [
      {
        type: 'erasure',
        tenantId: record.tenantId,
        commandId: record.commandId,
        subjectId: canonicalSubject(record.subjectId),
      },
    ],
    { limit: 1 },
  );
  const from = first !== undefined && first.seq < seq ? first.seq : seq;
  const current = (await completionsAfter(context, record, from)).filter(
    (completion) => completion.epoch === epoch,
  );
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
