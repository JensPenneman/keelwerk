import type { ApiVersionLedger, ExpectedLedgerEntry, LedgerEntry } from '@keelwerk/core';
import { appendLedgerEntry, refreshHeadEntry } from '@keelwerk/core';

/**
 * Cuts the head entry of a ledger into a released one and starts the next (section 18.2): the head
 * entry follows the sources one last time, then `date` is appended with the surface and module
 * versions in force. `implied` is the head the sources imply now. Returns the ledger and the entry.
 */
export function cutVersion(
  ledger: ApiVersionLedger,
  implied: ExpectedLedgerEntry,
  date: string,
  changes: readonly string[],
): { readonly ledger: ApiVersionLedger; readonly entry: LedgerEntry } {
  const entry: LedgerEntry = {
    version: date,
    surfaceHash: implied.surfaceHash,
    modules: implied.modules,
    changes,
  };
  return { ledger: appendLedgerEntry(refreshHeadEntry(ledger, implied), entry), entry };
}
