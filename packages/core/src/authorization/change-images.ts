import type { StorageRow } from '../storage/storage-row.ts';
import type { RowMatcher } from './row-matcher.ts';

/** The rows a forbidden-change test looks at, each with its matcher. */
export interface ChangeImages {
  /** The row before the write; set for transitions. */
  readonly pre?: StorageRow;
  readonly preMatches: RowMatcher;
  /** The row after the write. */
  readonly post: StorageRow;
  readonly postMatches: RowMatcher;
}
