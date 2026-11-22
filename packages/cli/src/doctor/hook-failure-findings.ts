import type { HookFailureFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** Tenant lifecycle hooks that failed and have not completed since (section 3.3). */
export function hookFailureFindings(
  failures: readonly HookFailureFact[],
): readonly DoctorFinding[] {
  return failures.map((failure) =>
    findingOf(
      'deployment',
      'warning',
      failure.tenantId,
      `the lifecycle hook ${failure.hookId} failed for tenant ${failure.tenantId}`,
      'fix the cause of the failure; the line stays until the hook completes for the tenant',
    ),
  );
}
