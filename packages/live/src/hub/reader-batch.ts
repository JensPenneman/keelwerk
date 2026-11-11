import type { Position, StorageRow, StoredEvent } from '@keelwerk/core';
import type { BatchEarlier } from './batch-earlier.ts';

/** What one pass of a reader found, shared by every listener of the scope. */
export interface ReaderBatch {
  /** Exclusive: the position the reader had read through before the pass. */
  readonly from: Position;
  /** Inclusive: the last event read, or the head when everything was read. */
  readonly to: Position;
  readonly events: readonly StoredEvent[];
  /** Entity to id to the post-image at the pass's head; undefined for a row that is gone (purged). */
  readonly rows: ReadonlyMap<string, ReadonlyMap<string, StorageRow | undefined>>;
  /** `${entity} ${planKey}` to id to the presented row, for the ids the plan selects (archived rows included). */
  readonly verdicts: ReadonlyMap<string, ReadonlyMap<string, StorageRow>>;
  /**
   * `${entity} ${planKey}` to what the plan selected at `from` among the streams the listeners of the
   * group could not decide (D6): one answer for every listener of the group, never one for each.
   */
  readonly earlier: ReadonlyMap<string, BatchEarlier>;
}
