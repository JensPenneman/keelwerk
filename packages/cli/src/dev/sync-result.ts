/** What the development database synchronisation did (section 13.6). */
export interface SyncResult {
  /** Migration files applied, as `<placement>/<app>: <track> <id>`. */
  readonly applied: readonly string[];
  /** Files with contract or rebuild steps that wait for a confirmation. */
  readonly deferred: readonly string[];
  readonly warnings: readonly string[];
}
