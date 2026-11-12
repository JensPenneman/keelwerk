import type { InvocationSession } from '@keelwerk/core';

/** The open streams of the process, counted by principal, tenant and in total (15.4.10). */
export interface StreamLimits {
  /**
   * Counts a stream of the session, opened from the client address (as the trusted-proxy facts say);
   * the answer releases it once. Past a bound: rate_limited `core.quota_exceeded`. An anonymous
   * session is counted against its address, not against the one principal every anonymous caller shares.
   */
  take(session: InvocationSession, address: string): () => void;
  /**
   * Counts one subscription on a socket that already holds its stream slot: against the tenant, the
   * process and, for an anonymous session, the tenant's anonymous bound and its client address (the
   * socket's); for any other session against no principal. The answer releases it once. Past a bound:
   * `core.quota_exceeded`.
   */
  takeSubscription(session: InvocationSession, address: string): () => void;
}
