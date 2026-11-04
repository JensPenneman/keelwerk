import type { ErrorAudience } from './error-audience.ts';
import type { KeelwerkError } from './keelwerk-error.ts';
import type { WireError } from './wire-error.ts';

const internalTitle = 'Internal server error.';

/**
 * The one serialised form of an error (sections 10 and 16.4.6). Operators and development see rule
 * ids and unredacted `internal` messages; everyone else gets the code, the kind, the message and
 * the deny reason, and an `internal` error shrinks to its taxonomy title without details. The
 * transport host adds the `requestId`.
 */
export function toWire(
  error: KeelwerkError,
  audience: ErrorAudience,
): Omit<WireError, 'requestId'> {
  const privileged = audience !== 'public';
  const redacted = error.kind === 'internal' && !privileged;
  return {
    kind: error.kind,
    code: error.code,
    message: redacted ? internalTitle : error.message,
    retryable: error.retryable,
    ...(error.retryAfter !== undefined && { retryAfter: error.retryAfter }),
    ...(!redacted &&
      error.issues !== undefined && {
        issues: error.issues.map((issue) => ({
          path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
          message: issue.message,
        })),
      }),
    ...(!redacted && error.details !== undefined && { details: error.details }),
    ...(error.kind === 'forbidden' && { reason: error.message }),
    ...(privileged && error.rules !== undefined && { rules: error.rules }),
  };
}
