import type { LedgerRecord } from '../kernel/ledger-record.ts';
import { erasureKey } from '../subjects/erasure-key.ts';

/** What tells one replayed record from another (an erasure by its identity, a tombstone by its scope and key id: a principal's key id is the same in the tenant and in its backend); undefined for any other record. */
export function replayedKeyOf(record: LedgerRecord): string | undefined {
  if (record.type === 'erasure') return erasureKey(record);
  if (record.type === 'keyTombstone')
    return `tombstone\u0000${record.scopeId}\u0000${record.keyId}`;
  return undefined;
}
