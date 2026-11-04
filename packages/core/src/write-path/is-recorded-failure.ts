import type { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * Whether a failed command's error is pinned to its command id (section 7.5): a deterministic
 * refusal is, a retryable failure (unavailable, rate limited, a version conflict the retry loop
 * gave up on), an internal error and a clash with another request's receipt are not.
 */
export function isRecordedFailure(error: unknown): error is KeelwerkError {
  if (typeof error !== 'object' || error === null || !('kind' in error) || !('code' in error)) {
    return false;
  }
  const failure = error as KeelwerkError;
  if (failure.retryable || failure.kind === 'unavailable' || failure.kind === 'internal') {
    return false;
  }
  if (failure.code === 'core.idempotency_mismatch' || failure.code === 'core.command_in_progress') {
    return false;
  }
  return !(
    failure.code === 'core.version_mismatch' &&
    (failure.details as { readonly ifVersion?: boolean } | undefined)?.ifVersion !== true
  );
}
