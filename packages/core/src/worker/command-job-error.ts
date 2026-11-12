import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { attemptErrorOf } from '../executors/attempt-error-of.ts';

/**
 * The failure a command stores (D9): in its receipt row and change record, in a job's history and
 * in a dead job. It is the closed projection of `attemptErrorOf`: the kind, a code of the core or
 * one `declared` by the action's module (else `core.<kind>`), retryable and retryAfter, and the
 * fixed message `The command failed with <code>.`. Never details, issues, rules or a reason, which
 * may repeat a personal value (a declared `accounts.email_taken` carries the address). The caller
 * that is still waiting keeps the full error; only what reaches storage is projected.
 */
export function commandJobError(error: unknown, declared: ReadonlySet<string>): KeelwerkError {
  const projected = attemptErrorOf(error, '', declared);
  return new KeelwerkError({
    kind: projected.kind,
    code: projected.code,
    message: `The command failed with ${projected.code}.`,
    retryable: projected.retryable,
    ...(projected.retryAfter === undefined ? {} : { retryAfter: projected.retryAfter }),
  });
}
