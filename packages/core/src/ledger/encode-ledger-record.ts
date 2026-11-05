import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { LedgerRecord } from '../kernel/ledger-record.ts';

/**
 * One line of the ledger file without its line feed: the record as RFC 8785 canonical JSON, so the
 * same record is the same bytes on every machine (S-34, final once written).
 */
export function encodeLedgerRecord(record: LedgerRecord): string {
  return canonicalizeJson(record);
}
