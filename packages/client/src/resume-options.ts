import type { WireError } from '@keelwerk/core';
import type { RetryPolicy } from './retry-policy.ts';

/** How `resumeFrames` reopens a subscription. */
export interface ResumeOptions {
  /** The token to start after. */
  readonly after?: string;
  readonly signal?: AbortSignal;
  /** Backoff between opens (`backoffDelay`); before the first frame, `retries` failed opens end the iteration. */
  readonly retry: RetryPolicy;
  /** Whether a failure of an open or of a running connection is a dropped connection. */
  readonly dropped: (failure: unknown) => boolean;
  /** What an `error` event, or `end` `version_retired`, is thrown as. */
  readonly failure: (error: WireError) => Error;
}
