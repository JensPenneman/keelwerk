import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { coreError } from '../http/core-error.ts';

/**
 * The error of an attempt whose lease is gone (9.5.4): it aborts the attempt's `Job.signal` and
 * fails the completion unit. It is not retryable, so a retry of the unit does not run it again.
 */
export function jobLeaseLost(): KeelwerkError {
  return coreError('core.job_lease_lost', {
    message: 'The worker lost its lease on the job.',
    retryable: false,
  });
}
