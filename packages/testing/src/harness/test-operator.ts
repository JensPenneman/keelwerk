import type { TestPrincipal } from './test-principal.ts';
import { testPrincipal } from './test-principal.ts';

/** An operator of a test: needs `operators: true` on `startTestRuntime`, which reads the claim `operator: true`. */
export function testOperator(subject = 'operator'): TestPrincipal {
  return testPrincipal(subject, { claims: { operator: true } });
}
