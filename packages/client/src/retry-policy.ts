/** How the client retries network failures (section 16.8.4): at most `retries` more attempts with full-jitter backoff. */
export interface RetryPolicy {
  /** Three by default. */
  readonly retries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** In [0, 1). */
  readonly random: () => number;
  readonly sleep: (milliseconds: number, signal: AbortSignal | undefined) => Promise<void>;
}
