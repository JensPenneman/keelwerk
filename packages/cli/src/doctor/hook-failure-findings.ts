import type { HookFailuresFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** Tenant lifecycle hooks that failed and have not completed since (section 3.3), and a note when the outcomes older than what doctor read were left out. */
export function hookFailureFindings({
  failures,
  olderUnread,
}: HookFailuresFact): readonly DoctorFinding[] {
  const found = failures.map((failure) =>
    findingOf(
      'deployment',
      'warning',
      failure.tenantId,
      `the lifecycle hook ${failure.hookId} failed for tenant ${failure.tenantId}`,
      'fix the cause of the failure; the line stays until the hook completes for the tenant',
    ),
  );
  return olderUnread
    ? [
        ...found,
        findingOf(
          'deployment',
          'note',
          'tenant hooks',
          'doctor read the newest outcomes of tenant hooks only: a failure older than that is not listed',
          'none needed',
        ),
      ]
    : found;
}
