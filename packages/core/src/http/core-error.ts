import type { CoreErrorCode } from '../errors/core-error-code.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import type { ErrorIssue } from '../errors/error-issue.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** What a transport-raised error may add to the registered message of its code. */
export interface CoreErrorOverrides {
  readonly message?: string;
  readonly issues?: readonly ErrorIssue[];
  readonly retryAfter?: number;
  /** Replaces the registered retry flag, for a code whose unit must not be re-run by a retry. */
  readonly retryable?: boolean;
}

/** Builds the error of a registered core code with its registered kind and message. */
export function coreError(code: CoreErrorCode, overrides: CoreErrorOverrides = {}): KeelwerkError {
  const spec = coreErrorCodes[code];
  const retryable = overrides.retryable ?? spec.retryable;
  return new KeelwerkError({
    kind: spec.kind,
    code,
    message: overrides.message ?? spec.message,
    ...(retryable !== undefined && { retryable }),
    ...(overrides.issues !== undefined && { issues: overrides.issues }),
    ...(overrides.retryAfter !== undefined && { retryAfter: overrides.retryAfter }),
  });
}
