import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ApiVersionLedger } from './api-version-ledger.ts';
import type { ExpectedLedgerEntry } from './check-ledger.ts';

function sameModules(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

/**
 * The ledger with its head entry brought to the surface the sources imply (section 13.7): the head
 * is the working entry until `surface version new` cuts it, so its hash and module versions follow
 * the sources; released entries are never touched (18.6). A head of another version is refused.
 */
export function refreshHeadEntry(
  ledger: ApiVersionLedger,
  implied: ExpectedLedgerEntry,
): ApiVersionLedger {
  const head = ledger.versions.at(-1);
  if (head === undefined || head.version !== implied.version) {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.api_version_invalid',
      message: `The ledger of '${ledger.app}' has no head entry for '${implied.version}'.`,
    });
  }
  if (head.surfaceHash === implied.surfaceHash && sameModules(head.modules, implied.modules)) {
    return ledger;
  }
  return {
    ...ledger,
    versions: [
      ...ledger.versions.slice(0, -1),
      { ...head, surfaceHash: implied.surfaceHash, modules: implied.modules },
    ],
  };
}
