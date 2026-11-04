import type { Position } from './position.ts';
import type { StorageRow } from './storage-row.ts';

/** One page of rows. */
export interface RowPage {
  readonly rows: readonly StorageRow[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
  };
  readonly total?: number;
  /** The scope position the statement saw; set when the query asked for `positioned` (S-19). */
  readonly position?: Position;
}
