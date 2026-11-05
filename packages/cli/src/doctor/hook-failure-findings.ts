import type { DeploymentFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** Tenant lifecycle hooks that failed and have not completed since (section 3.3, S-27). */
export function hookFailureFindings(facts: DeploymentFacts): readonly DoctorFinding[] {
  return facts.hookFailures.map((failure) =>
    findingOf(
      'deployment',
      'warning',
      failure.tenantId,
      `the lifecycle hook ${failure.hookId} failed for tenant ${failure.tenantId}`,
      'fix the hook; M2 reruns failed hooks from the queue (S-27)',
    ),
  );
}
