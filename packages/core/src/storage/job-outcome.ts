import type { WireError } from '../errors/wire-error.ts';

/** How an attempt ended, as `JobStore.complete` receives it. */
export type JobOutcome =
  | { readonly kind: 'succeeded' }
  /** Retryable failure: the next attempt is scheduled at `at`. */
  | { readonly kind: 'retry'; readonly at: Temporal.Instant; readonly error: WireError }
  /** Out of retries with a dead-letter target: the job keeps its input in state `dead`. */
  | { readonly kind: 'dead'; readonly error: WireError }
  /** Out of retries without one: history only. */
  | { readonly kind: 'failed'; readonly error: WireError };
