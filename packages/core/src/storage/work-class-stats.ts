/** Queue statistics per queue and capability set, over every namespace (section 21.4). */
export interface WorkClassStats {
  readonly queue: string;
  readonly capabilities: readonly string[];
  /** Available and due now. */
  readonly due: number;
  readonly oldestDueSeconds: number;
  /** Smoothed over a minute. */
  readonly arrivalsPerSecond: number;
  readonly meanRunSeconds: number;
  readonly running: number;
  readonly nextDueAt: Temporal.Instant | null;
  /** `queues.<q>.slo` in seconds: target wait from due to start. */
  readonly sloSeconds: number;
}
