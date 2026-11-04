import type { JobOutcome, WireError } from '@keelwerk/core';

/** A successful outcome. */
export const succeeded: JobOutcome = { kind: 'succeeded' };

/** A retryable failure. */
export const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
