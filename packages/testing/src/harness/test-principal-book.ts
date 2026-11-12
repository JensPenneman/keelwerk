import type { TestPrincipal } from './test-principal.ts';

/**
 * What the test resolver saw and what a test revoked: `seen` is keyed by the principal id (the
 * subject when a principal names none) and holds the last principal seen under it; `fromRef` answers
 * that principal, and null once its id or its subject is revoked or when none was seen.
 */
export interface TestPrincipalBook {
  readonly seen: Map<string, TestPrincipal>;
  readonly revoked: Set<string>;
}
