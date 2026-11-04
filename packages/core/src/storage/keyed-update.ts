import type { StorageRow } from './storage-row.ts';

/** One versioned row update. */
export interface KeyedUpdate {
  readonly id: string;
  readonly expectedVersion: number;
  /** The complete new state row, including version and framework columns. */
  readonly values: StorageRow;
}
