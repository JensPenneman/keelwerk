/**
 * What one bounded retention purge answers (14.7.1, 15.1.11): the rows it deleted and whether a
 * row that it would delete is left. `more` is read from committed data after the delete, not
 * derived from the size of the batch: a purge that waited on rows another pass deleted removes
 * fewer than its limit while older candidates remain. A row another pass is still deleting counts
 * as left, so `false` is the only answer that says the buffer is empty of candidates.
 */
export interface PurgeBatch {
  readonly removed: number;
  readonly more: boolean;
}
