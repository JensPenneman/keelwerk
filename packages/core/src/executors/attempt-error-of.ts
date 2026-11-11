import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';

/** The longest wait an attempt's error may ask for, in seconds. */
const maxRetryAfterSeconds = 86_400;

/** A wait in seconds as a stored value: finite and not negative, rounded up, capped; anything else is no wait. */
function retryAfterOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.ceil(value), maxRetryAfterSeconds);
}

/**
 * The closed projection of a failed attempt (7.9.6): kind, code, retryable, retryAfter and the
 * request id of the attempt. A throw that is no keelwerk error is `internal` with `core.internal`.
 * A code is kept only when it is a code of the core or one the effect's module declared
 * (`declared`); any other code, however well formed, is text the executor chose (an SMTP or HTTP
 * executor can put a mailbox or a response body into one) and becomes `core.<kind>`. The wait is
 * kept only when it is a finite, non-negative number of seconds, rounded up and capped at a day.
 * Never a message: an executor's text may repeat the personal value the input sealed.
 */
export function attemptErrorOf(
  error: unknown,
  requestId: string,
  declared: ReadonlySet<string>,
): EffectAttemptError {
  if (!isKeelwerkError(error)) {
    return { kind: 'internal', code: 'core.internal', retryable: false, requestId };
  }
  const retryAfter = retryAfterOf(error.retryAfter);
  return {
    kind: error.kind,
    code:
      Object.hasOwn(coreErrorCodes, error.code) || declared.has(error.code)
        ? error.code
        : `core.${error.kind}`,
    retryable: error.retryable,
    ...(retryAfter === undefined ? {} : { retryAfter }),
    requestId,
  };
}
