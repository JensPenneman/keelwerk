import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { attemptErrorOf } from '../executors/attempt-error-of.ts';

/**
 * The error a failed job the kernel made stores in its history (a reaction, a timer, a schedule
 * tick): the closed projection of `attemptErrorOf`, which keeps the kind, a code of the core or one
 * `declared` by the module of the action, else `core.<kind>`, retryable and retryAfter, and the
 * fixed message `The <subject> failed with <code>.`. Never the action's own text, issues, details
 * or rules, which may repeat a personal value. `core.job_lease_lost` is kept, so the worker still
 * recognises a lost lease.
 */
export function kernelJobError(
  error: unknown,
  declared: ReadonlySet<string>,
  subject: 'reaction' | 'timer' | 'schedule',
): KeelwerkError {
  const projected = attemptErrorOf(error, '', declared);
  return new KeelwerkError({
    kind: projected.kind,
    code: projected.code,
    message: `The ${subject} failed with ${projected.code}.`,
    retryable: projected.retryable,
    ...(projected.retryAfter === undefined ? {} : { retryAfter: projected.retryAfter }),
  });
}
