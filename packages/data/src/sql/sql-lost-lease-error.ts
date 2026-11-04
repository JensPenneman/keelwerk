import type { WireError } from '@keelwerk/core';

/** The error a dead letter made by three lost leases carries (9.5.4). */
export const sqlLostLeaseError: WireError = {
  kind: 'unavailable',
  code: 'core.job_lease_lost',
  message: 'The worker lost its lease on the job.',
  retryable: true,
  requestId: '',
};
