import type { ApiVersionLedger } from './api-version-ledger.ts';

/** A ledger with no entries for an app. */
export function emptyApiVersionLedger(app: string): ApiVersionLedger {
  return { format: 'keelwerk.ledger/1', app, versions: [] };
}
