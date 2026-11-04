/** What one committed unit measured, in milliseconds of the client's monotonic clock. */
export interface AppendTiming {
  readonly totalMs: number;
  /** From sending the counter update until it returned: the wait for earlier tails of the scope. */
  readonly tailWaitMs: number;
  /** From holding the counter's row lock until COMMIT returned: how long the scope is serialised. */
  readonly tailHoldMs: number;
  readonly loadMs: readonly number[];
  readonly position: number;
  /** True when the target's load was tagged with a position below the stream's last committed event. */
  readonly staleTargetPosition: boolean;
  /** performance.now() when COMMIT returned. */
  readonly committedAt: number;
}
