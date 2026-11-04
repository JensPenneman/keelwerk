/**
 * The clock a target's adapter reads, which the suites may move: `now` is the instant the adapter's
 * units see, `advance` moves it forward without waiting.
 */
export interface ConformanceClock {
  now(): Temporal.Instant;
  advance(milliseconds: number): void;
}
