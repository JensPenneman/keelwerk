import type { ConsumerSpec, Logger, Position } from '@keelwerk/core';

/** What a runner lends to the answer to a failed batch: its settings and the state it updates. */
export interface FailedBatchState {
  readonly spec: ConsumerSpec;
  readonly maxAttempts: number;
  /** How long a scope waits after a failure outside `consume`, and after a limit without a hint. */
  readonly holdMs: number;
  readonly log: Logger;
  /** Scopes read one event at a time until the position. */
  readonly singles: Map<string, Position>;
  /** The event a scope is failing on and the deliveries that failed so far. */
  readonly failing: Map<string, { readonly eventId: string; readonly count: number }>;
  hold(scopeId: string, ms: number): void;
  enqueue(scopeId: string): void;
}
