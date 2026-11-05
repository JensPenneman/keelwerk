import { sortedJson } from '../surface/sorted-json.ts';
import type { ApiVersionLedger } from './api-version-ledger.ts';

/** The text of `ledger.json`: sorted keys, two-space indentation, LF, a trailing newline (section 13.7). */
export function renderApiVersionLedger(ledger: ApiVersionLedger): string {
  return sortedJson(ledger);
}
