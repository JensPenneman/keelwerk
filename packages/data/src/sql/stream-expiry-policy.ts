import { durationMs } from '@keelwerk/core';
import { malformedQuery } from './malformed-query.ts';

/** An expiry request checked: the age in milliseconds and the count per key, each `null` when absent. */
export interface StreamExpiryPolicy {
  readonly maxAgeMs: number | null;
  readonly maxPerKey: number | null;
}

/**
 * Checks what `StreamRecordStore.expire` takes: a policy with at least one member, a `maxAge` that
 * `durationMs` reads, `maxPerKey` and `limit` integers of at least 1. Anything else is a
 * `malformedQuery`, the same on every adapter.
 */
export function streamExpiryPolicy(
  policy: { readonly maxAge?: string; readonly maxPerKey?: number },
  limit: number,
): StreamExpiryPolicy {
  if (!Number.isInteger(limit) || limit < 1)
    throw malformedQuery('limit must be an integer of at least 1');
  if (policy.maxAge === undefined && policy.maxPerKey === undefined) {
    throw malformedQuery('an expiry policy needs maxAge or maxPerKey');
  }
  if (
    policy.maxPerKey !== undefined &&
    (!Number.isInteger(policy.maxPerKey) || policy.maxPerKey < 1)
  ) {
    throw malformedQuery('maxPerKey must be an integer of at least 1');
  }
  return {
    maxAgeMs: policy.maxAge === undefined ? null : durationMs(policy.maxAge),
    maxPerKey: policy.maxPerKey ?? null,
  };
}
