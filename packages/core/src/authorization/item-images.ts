import type { StorageRow } from '../storage/storage-row.ts';
import type { RowMatcher } from './row-matcher.ts';

/** The rows an item check looks at, each with the matcher that was built for it. */
export interface ItemImages {
  /** The row before the action (reads, transitions). */
  readonly pre?: StorageRow;
  /** The row the action produced (creates, transitions). */
  readonly post?: StorageRow;
  /** Matchers from `createRowMatcher` when the conditions hold relation quantifiers. */
  readonly matchers?: { readonly pre?: RowMatcher; readonly post?: RowMatcher };
  /** The fields the write changes; omitted when the caller does not restrict them. */
  readonly changed?: readonly string[];
  /** `strict` (default) refuses a change outside the allowed fields; `strip` reports them to drop. */
  readonly mode?: 'strict' | 'strip';
}
