import type { Condition } from '../conditions/condition.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/** Decides a condition for a row; the engine's checks are synchronous once a matcher exists. */
export type RowMatcher = (condition: Condition, row: StorageRow) => boolean;
