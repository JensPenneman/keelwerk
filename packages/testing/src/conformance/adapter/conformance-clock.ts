/**
 * The clock a target's adapter reads, which the suites may move: `now` is the instant the adapter's
 * units see, `advance` moves it without waiting. A positive number of milliseconds moves it
 * forward, a negative one back; seven cases of the bucket store move it back to give the clocks of
 * two processes that differ (S-36), and a target whose clock ignores a negative value fails each of
 * them with one message that says so.
 */
export interface ConformanceClock {
  now(): Temporal.Instant;
  advance(milliseconds: number): void;
}
