import { defineCheck } from './define-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import { findingOf } from './finding-of.ts';

/** How long an erasure may stay unfinished before doctor warns: the worker normally finishes one in seconds. */
const stuckAfterMs = 3_600_000;

/** How long, in the unit that reads best: minutes under two hours, else whole hours. */
function agoOf(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 120) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `${Math.floor(minutes / 60)} hours`;
}

/**
 * Held tenants (section 14.7.6): a tenant with an erasure that has not completed at its current
 * epoch is refused (`core.unavailable`) by every process that starts now, until the erasure worker
 * has appended the completion; normally a few seconds, after a restore until every completed
 * erasure has run again. One note per tenant, in id order; a tenant whose oldest unfinished erasure
 * was recorded more than an hour ago gets a warning instead, which says only what doctor knows: no
 * completion is recorded for the tenant's current epoch for that long, the receipt stays
 * `accepted`, and the data may still be readable. An erasure counts as applied again only when the
 * ledger holds a completion of that same record at an earlier epoch (a restore moved the epoch
 * after it); its warning says so, and neither claims the data is readable nor that the receipt
 * stays accepted, which doctor cannot know. No unfinished erasure gives nothing.
 */
export const heldTenantsCheck: DeploymentCheck = defineCheck({
  group: 'held-tenants',
  name: 'held tenants',
  needs: ['heldTenants'],
  judge: ({ heldTenants }) =>
    heldTenants.map(({ tenantId, unfinishedForMs, appliedAgain }) =>
      unfinishedForMs > stuckAfterMs
        ? findingOf(
            'held-tenants',
            'warning',
            tenantId,
            appliedAgain
              ? `no completion of an erasure is recorded for the current epoch of the tenant; the erasure was recorded ${agoOf(unfinishedForMs)} ago and completed at an earlier epoch, so it is being applied again`
              : `no completion of an erasure is recorded for the current epoch of the tenant for ${agoOf(unfinishedForMs)}; its receipt stays accepted and the data it names may still be readable`,
            'look at the work processes that serve the tenant and their log; the worker tries the erasure again until it finishes',
          )
        : findingOf(
            'held-tenants',
            'note',
            tenantId,
            'the tenant has an erasure left to run; a process that starts now refuses it with core.unavailable until the completion',
            'nothing to do while the erasure worker runs; when it does not complete, look at the work processes and their log',
          ),
    ),
});
