import type { KeyTombstoneRecord } from '../ledger/key-tombstone-record.ts';
import type { ReplayContext } from './replay-ledger-records.ts';
import { replayLedgerRecords } from './replay-ledger-records.ts';

/** The tombstones of keys an erasure destroyed, from the ledger union, each key id once. */
export function replayKeyTombstones(
  context: ReplayContext,
): AsyncGenerator<KeyTombstoneRecord, void, undefined> {
  return replayLedgerRecords(
    context,
    (record) =>
      record.type === 'keyTombstone' && record.reason === 'erasure' ? record : undefined,
    (record) => record.keyId,
  );
}
