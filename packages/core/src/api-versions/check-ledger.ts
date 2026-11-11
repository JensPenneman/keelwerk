import type { ApiVersionLedger, LedgerEntry } from './api-version-ledger.ts';
import { sameChangeIds } from './same-change-ids.ts';

function sameModules(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const names = Object.keys(left);
  return (
    names.length === Object.keys(right).length && names.every((name) => left[name] === right[name])
  );
}

/** What the app implies for one declared API version. */
export interface ExpectedLedgerEntry {
  readonly version: string;
  readonly surfaceHash: string;
  readonly modules: Readonly<Record<string, string>>;
  /** The ids of the version changes the version adopts, as `defineApiVersions` lists them; absent: not compared. */
  readonly changes?: readonly string[];
}

/** One disagreement between the ledger and the app. */
export interface LedgerProblem {
  readonly code:
    | 'ledgerApp'
    | 'ledgerOrder'
    | 'ledgerEntryMissing'
    | 'ledgerEntryUnknown'
    | 'ledgerHashDrift'
    | 'ledgerModulesDrift'
    | 'ledgerChangeUnknown'
    | 'ledgerChangesDrift';
  readonly version?: string;
  readonly message: string;
}

/**
 * Compares the ledger with the app: the app id, a strictly increasing order, an entry for every
 * declared version, the surface hash and module versions the app derives for the head entry only
 * (an additive change reaches every version, section 18.2, and a released entry is never edited,
 * section 18.6, so only the head's record follows the app), and no entry newer than the head.
 * Entries older than the oldest declared version are retired versions and stay. The adopted
 * change ids of every declared version, released ones included, must equal what
 * `defineApiVersions` lists (`ledgerChangesDrift`), and, when `registered` is given, each id the
 * ledger records must be one a module registers (`ledgerChangeUnknown`).
 */
export function checkLedger(
  ledger: ApiVersionLedger,
  app: string,
  expected: readonly ExpectedLedgerEntry[],
  registered?: ReadonlySet<string>,
): readonly LedgerProblem[] {
  const problems: LedgerProblem[] = [];
  if (ledger.app !== app) {
    problems.push({
      code: 'ledgerApp',
      message: `The ledger is for '${ledger.app}', not '${app}'.`,
    });
  }
  let previous = '';
  for (const entry of ledger.versions) {
    if (entry.version <= previous) {
      problems.push({
        code: 'ledgerOrder',
        version: entry.version,
        message: `Ledger entry '${entry.version}' does not come after '${previous}'.`,
      });
    }
    previous = entry.version;
  }
  if (registered !== undefined) {
    for (const entry of ledger.versions) {
      for (const id of entry.changes.filter((item) => !registered.has(item))) {
        problems.push({
          code: 'ledgerChangeUnknown',
          version: entry.version,
          message: `The ledger entry '${entry.version}' adopts '${id}', which no module registers.`,
        });
      }
    }
  }
  const byVersion = new Map<string, LedgerEntry>(
    ledger.versions.map((entry) => [entry.version, entry]),
  );
  const oldest = expected[0]?.version ?? '';
  const head = expected.at(-1)?.version;
  const declared = new Set(expected.map((entry) => entry.version));
  for (const want of expected) {
    const have = byVersion.get(want.version);
    if (have === undefined) {
      problems.push({
        code: 'ledgerEntryMissing',
        version: want.version,
        message: `The ledger has no entry for '${want.version}'.`,
      });
      continue;
    }
    if (want.changes !== undefined && !sameChangeIds(have.changes, want.changes)) {
      problems.push({
        code: 'ledgerChangesDrift',
        version: want.version,
        message: `The changes '${want.version}' adopts in defineApiVersions (${want.changes.join(', ') || 'none'}) differ from the ledger's (${have.changes.join(', ') || 'none'}).`,
      });
    }
    if (want.version !== head) continue;
    if (have.surfaceHash !== want.surfaceHash) {
      problems.push({
        code: 'ledgerHashDrift',
        version: want.version,
        message: `The surface of '${want.version}' is ${want.surfaceHash}, the ledger records ${have.surfaceHash}.`,
      });
    }
    if (!sameModules(have.modules, want.modules)) {
      problems.push({
        code: 'ledgerModulesDrift',
        version: want.version,
        message: `The module versions in force at '${want.version}' differ from the ledger's.`,
      });
    }
  }
  for (const entry of ledger.versions) {
    if (!declared.has(entry.version) && entry.version >= oldest) {
      problems.push({
        code: 'ledgerEntryUnknown',
        version: entry.version,
        message: `The ledger records '${entry.version}', which defineApiVersions does not declare.`,
      });
    }
  }
  return problems;
}
