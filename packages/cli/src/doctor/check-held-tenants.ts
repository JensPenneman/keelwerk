import { defineCheck } from './define-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import { findingOf } from './finding-of.ts';

/**
 * Held tenants (section 14.7.6): a tenant with an erasure that has not completed at its current
 * epoch is refused (`core.unavailable`) by every process that starts now, until the erasure worker
 * has appended the completion; normally a few seconds, after a restore until every completed
 * erasure has run again. One note per tenant, in id order; no unfinished erasure gives nothing.
 */
export const heldTenantsCheck: DeploymentCheck = defineCheck({
  group: 'held-tenants',
  name: 'held tenants',
  needs: ['heldTenants'],
  judge: ({ heldTenants }) =>
    heldTenants.map((tenantId) =>
      findingOf(
        'held-tenants',
        'note',
        tenantId,
        'the tenant has an erasure left to run; a process that starts now refuses it with core.unavailable until the completion',
        'nothing to do while the erasure worker runs; when it does not complete, look at the work processes and their log',
      ),
    ),
});
