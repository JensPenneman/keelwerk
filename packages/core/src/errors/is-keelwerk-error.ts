import { isErrorKind } from './is-error-kind.ts';
import type { KeelwerkError } from './keelwerk-error.ts';

/** True for a `KeelwerkError`, also one made by another copy of the core (a duplicated install). */
export function isKeelwerkError(value: unknown): value is KeelwerkError {
  if (!(value instanceof Error)) {
    return false;
  }
  const candidate = value as Error & {
    readonly kind?: unknown;
    readonly code?: unknown;
    readonly retryable?: unknown;
  };
  return (
    candidate.name === 'KeelwerkError' &&
    isErrorKind(candidate.kind) &&
    typeof candidate.code === 'string' &&
    typeof candidate.retryable === 'boolean'
  );
}
