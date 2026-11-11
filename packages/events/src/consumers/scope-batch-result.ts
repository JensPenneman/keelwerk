import type { Position, StoredEvent } from '@keelwerk/core';

/** How one scope batch ended (D3, D5). */
export type ScopeBatchResult =
  | {
      /** `more`: the batch was full, so more may wait; `caughtUp`: the scope's log is read to its end. */
      readonly kind: 'more' | 'caughtUp';
      readonly delivered: number;
      readonly to: Position | null;
    }
  | {
      readonly kind: 'failed';
      readonly error: unknown;
      /** What `consume` was called with when it threw; empty when the failure came from anywhere else. */
      readonly events: readonly StoredEvent[];
      /** How many events the batch read, those of parked streams included. */
      readonly read: number;
      /** The position of the last event the batch read; `null` when it read none. */
      readonly readTo: Position | null;
    };
