import type { ErrorKind } from './error-kind.ts';
import type { ErrorThrowOptions } from './error-throw-options.ts';
import { KeelwerkError } from './keelwerk-error.ts';

/** Builds a `KeelwerkError`, passing on only the members that are set (`exactOptionalPropertyTypes`). */
export function createError(
  kind: ErrorKind,
  code: string,
  message: string,
  details: unknown,
  options: ErrorThrowOptions,
  retryable?: boolean,
): KeelwerkError {
  const retry = options.retryable ?? retryable;
  return new KeelwerkError({
    kind,
    code,
    message: options.message ?? message,
    ...(details !== undefined && { details }),
    ...(options.issues !== undefined && { issues: options.issues }),
    ...(retry !== undefined && { retryable: retry }),
    ...(options.retryAfter !== undefined && { retryAfter: options.retryAfter }),
    ...(options.rules !== undefined && { rules: options.rules }),
    ...(options.cause !== undefined && { cause: options.cause }),
  });
}
