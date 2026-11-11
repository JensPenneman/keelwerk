import type { TestPrincipal } from './test-principal.ts';

/**
 * What the test resolver saw and what a test revoked: `fromRef` answers the last principal seen for
 * a subject, and null once the subject is revoked or was never seen.
 */
export interface TestPrincipalBook {
  readonly seen: Map<string, TestPrincipal>;
  readonly revoked: Set<string>;
}
