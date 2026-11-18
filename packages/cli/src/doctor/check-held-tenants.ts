import type { DeploymentFacts } from './deployment-facts.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * Held tenants (section 14.7.6): a tenant with an erasure that has not completed at its current
 * epoch is refused (`core.unavailable`) by every process that starts now, until the erasure worker
 * has appended the completion; normally a few seconds, after a restore until every completed
 * erasure has run again. One note per tenant, in id order; a reader that cannot list them, or no
 * unfinished erasure, gives nothing.
 */
export async function checkHeldTenants(
  input: DeploymentInput,
  _facts: DeploymentFacts,
  _now: Temporal.Instant,
): Promise<readonly DoctorFinding[]> {
  const tenants = (await input.reader?.heldTenants?.()) ?? [];
  return tenants.map((tenantId) =>
    findingOf(
      'held-tenants',
      'note',
      tenantId,
      'the tenant has an erasure left to run; a process that starts now refuses it with core.unavailable until the completion',
      'nothing to do while the erasure worker runs; when it does not complete, look at the work processes and their log',
    ),
  );
}
