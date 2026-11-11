import type { InvocationSession } from '@keelwerk/core';

/** The open streams of the process, counted by principal, tenant and in total (15.4.10). */
export interface StreamLimits {
  /**
   * Counts a stream of the session, opened from the client address (as the trusted-proxy facts say);
   * the answer releases it once. Past a bound: rate_limited `core.quota_exceeded`. An anonymous
   * session is counted against its address, not against the one principal every anonymous caller shares.
   */
  take(session: InvocationSession, address: string): () => void;
}
