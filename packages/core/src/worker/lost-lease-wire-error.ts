import type { WireError } from '../errors/wire-error.ts';

/**
 * The error a job ends with when its leases were lost too often (9.5.4). The store's dead letter
 * carries it as it is; the taker's dead letter for a job that carries a receipt
 * (`settleExhaustedJob`) and that receipt carry its projection (same kind, code and retryable).
 */
export const lostLeaseWireError: WireError = {
  kind: 'unavailable',
  code: 'core.job_lease_lost',
  message: 'The worker lost its lease on the job.',
  retryable: true,
  requestId: '',
};
