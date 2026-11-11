import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { kernelJobError } from '../worker/kernel-job-error.ts';

/**
 * The error a failed reaction job stores in its history (lead 7): the closed projection of
 * `kernelJobError`, which keeps the kind, a code of the core or one `declared` by the reaction's
 * module (else `core.<kind>`), retryable and retryAfter, and the fixed message `The reaction failed
 * with <code>.`. Never the reaction's own text, issues, details or rules, which may repeat a
 * personal value. `core.job_lease_lost` is kept, so the worker still recognises a lost lease.
 */
export function reactionJobError(error: unknown, declared: ReadonlySet<string>): KeelwerkError {
  return kernelJobError(error, declared, 'reaction');
}
