import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The error the retry policy judges for a failed attempt: a keelwerk error is replaced by one that
 * has only what the closed projection keeps (kind, stored code, retryable, a normalised wait), so
 * an executor's wait of NaN or a year never reaches the clock arithmetic of the queue. Any other
 * throw is judged as it is.
 */
export function judgedError(error: unknown, projection: EffectAttemptError): unknown {
  if (!isKeelwerkError(error)) return error;
  return new KeelwerkError({
    kind: projection.kind,
    code: projection.code,
    message: 'The effect failed.',
    retryable: projection.retryable,
    ...(projection.retryAfter === undefined ? {} : { retryAfter: projection.retryAfter }),
  });
}
