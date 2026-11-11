import type { NamespaceRef, Position, StreamRef } from '@keelwerk/core';

/** How a pass ended: whether the runner holds the lease and how many batches it committed. */
export interface ConsumerPass {
  readonly holding: boolean;
  readonly batches: number;
}

/** One consumer in one namespace (15.2.3). */
export interface ConsumerRunner {
  readonly consumer: string;
  readonly namespace: NamespaceRef;
  /** Queues the scopes at the tail unless queued; ignored while the lease is not held. */
  wake(scopeIds: readonly string[]): void;
  /**
   * One pass on the runtime clock (D1 to D4): readiness, acquire or renew when due, the start of a
   * `start: 'now'` consumer that has not started (which ends the pass), the sweep and the replay of
   * parked streams that follow an acquisition (retried by every pass until they succeed), then the
   * pending scopes round-robin, one batch per turn, until none is pending and due. With `sweep`, the
   * scopes that moved in the namespace are queued first.
   */
  pass(options?: { readonly sweep?: boolean }): Promise<ConsumerPass>;
  /**
   * `unparkStream`, run between the batches of this runner; `unavailable` (`core.unavailable`) unless
   * the runner holds the lease and is not stopping, so `consume` never runs in two processes.
   */
  unpark(scopeId: string, stream: StreamRef): Promise<Position | null>;
  /** The next renewal or acquisition attempt, or the earliest held scope, on the runtime clock. */
  dueAt(): Temporal.Instant;
  /** Starts no further scope, replay or turn; the work in flight ends. Synchronous, safe to repeat. */
  halt(): void;
  /**
   * Halts, then hands the lease over once the work in flight has ended. When it has not ended by the
   * deadline the lease is not handed over: another process would then run `consume` beside it, so
   * the lease is left to expire.
   */
  stop(deadline: Temporal.Instant): Promise<void>;
}
