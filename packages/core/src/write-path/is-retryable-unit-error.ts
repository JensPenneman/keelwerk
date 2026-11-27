import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';

/** Whether `retryUnit` repeats a failed unit: an adapter's retry signal, or a version conflict the command did not ask for with `ifVersion`. */
export function isRetryableUnitError(error: unknown): boolean {
  if (error instanceof RetryableUnitError) return true;
  return (
    error instanceof KeelwerkError &&
    error.code === 'core.version_mismatch' &&
    (error.details as { readonly ifVersion?: boolean } | undefined)?.ifVersion !== true
  );
}
