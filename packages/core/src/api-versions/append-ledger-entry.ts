import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ApiVersionLedger, LedgerEntry } from './api-version-ledger.ts';

/**
 * The ledger with one more entry at its end. Entries are never edited or removed (section 18.6): a
 * version that does not come after the newest one is refused, so a released entry cannot be replaced.
 */
export function appendLedgerEntry(ledger: ApiVersionLedger, entry: LedgerEntry): ApiVersionLedger {
  const newest = ledger.versions.at(-1);
  if (newest !== undefined && entry.version <= newest.version) {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.api_version_invalid',
      message: `The ledger of '${ledger.app}' ends at '${newest.version}'; '${entry.version}' cannot be appended.`,
    });
  }
  return { ...ledger, versions: [...ledger.versions, entry] };
}
