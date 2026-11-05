import type { CatalogueDifference } from '@keelwerk/data';

/** What `db check` found for one app: the files that failed to apply, and where the catalogue differs from the snapshots. */
export interface ScratchCheckResult {
  readonly app: string;
  /** The tracks that were migrated, in run order. */
  readonly tracks: readonly string[];
  /** Set when a file could not be applied; the comparison is then skipped. */
  readonly failure?: string;
  readonly differences: readonly CatalogueDifference[];
}
