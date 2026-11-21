import type { StoredJobSpec } from '@keelwerk/core';

/**
 * Whether a receipt may hang on the job: an action job whose run carries a command id. The store
 * never ends such a job for lost leases, however often they were lost: from `lostLeaseLimit` on it
 * hands the job out with `StoredJob.leasesExhausted`, and its taker ends it together with its
 * receipt, without running it. Any other job is a dead letter at `lostLeaseLimit`, so a job that
 * brings its process down cannot do so again and again.
 */
export function mayHoldReceipt(spec: Pick<StoredJobSpec, 'kind' | 'run'>): boolean {
  return (
    spec.kind === 'action' && 'commandId' in spec.run && typeof spec.run.commandId === 'string'
  );
}
