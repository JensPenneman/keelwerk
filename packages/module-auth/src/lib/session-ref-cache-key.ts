/**
 * The key of the in-memory principal cache for a session judged by its stored reference (queued
 * work, a redeemed ticket, an open stream). It is a cache key and no job key.
 */
export function sessionRefCacheKey(sessionId: string): string {
  return `auth.session:ref:${sessionId}`;
}
