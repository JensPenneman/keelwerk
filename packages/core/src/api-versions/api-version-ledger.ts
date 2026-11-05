/** One released API version in the ledger: what was in force when it was cut (section 18.2). */
export interface LedgerEntry {
  /** The dated API version. */
  readonly version: string;
  /** The surface hash of the app at this version. */
  readonly surfaceHash: string;
  /** Module id to the module version in force, sorted by id when rendered. */
  readonly modules: Readonly<Record<string, string>>;
  /** The ids of the version changes the version adopts, oldest first. */
  readonly changes: readonly string[];
}

/** `generated/api-surface/<app>/ledger.json`: the append-only record of an app's API versions (format `keelwerk.ledger/1`, F-13). */
export interface ApiVersionLedger {
  readonly format: 'keelwerk.ledger/1';
  readonly app: string;
  /** Oldest first, dates strictly increasing. */
  readonly versions: readonly LedgerEntry[];
}
