import type { ErasureRecord, RuntimeServiceContext } from '@keelwerk/core';
import { replayErasureRecords } from '@keelwerk/core';
import type { Completions } from './create-completions.ts';

/** What one pass over the ledger union needs, read once. */
export interface ErasureLedger {
  /** The erasure records: the control ledger's in ledger order, then the sinks', each erasure once (`erasureKey`). */
  readonly records: readonly ErasureRecord[];
  /** The key ids the control ledger holds a tombstone for. */
  readonly tombstoned: ReadonlySet<string>;
  /** The control ledger's head when it was read: what the worker polls after. */
  readonly lastSeq: bigint;
}

/**
 * The erasure records of the union of the control ledger and every sink (14.7.6), the completions
 * and the tombstoned key ids, from ONE read of the control ledger and one read of each sink, however
 * many erasures there are. The completions go into `completions`, which the worker keeps for its
 * lifetime. The sinks are outside the placement and its backups, so a record the control copy lost
 * to a restore is still found; a completion is never read from a sink. A sink that cannot be read
 * is logged and left out: it must not hide the control ledger's records, nor keep the worker from
 * taking the control ledger's head.
 */
export async function readErasureLedger(
  context: Pick<RuntimeServiceContext, 'control' | 'ledgers' | 'log'>,
  completions: Completions,
): Promise<ErasureLedger> {
  const records: ErasureRecord[] = [];
  const tombstoned = new Set<string>();
  let lastSeq = 0n;
  // The union is `replayErasureRecords`: the control ledger, then each sink, one record for each
  // erasure. The same read of the control ledger feeds the completions, the tombstones and the head.
  for await (const record of replayErasureRecords(context, {
    observe: ({ seq, record: entry }) => {
      lastSeq = seq;
      completions.observe(entry);
      if (entry.type === 'keyTombstone') tombstoned.add(entry.keyId);
    },
    onSinkError: (cause) => {
      context.log.error('a ledger sink could not be read; its erasure records are left out', {
        cause,
      });
    },
  })) {
    records.push(record);
  }
  return { records, tombstoned, lastSeq };
}
