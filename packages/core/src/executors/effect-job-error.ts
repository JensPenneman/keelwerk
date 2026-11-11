import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import type { WireError } from '../errors/wire-error.ts';

/**
 * The wire error a failed effect job stores in its history and the continuation reads: the closed
 * projection plus the fixed message `The effect failed with <code>.` for every effect job, whatever
 * the code. It carries no issues, details, reason or rules, and never the executor's own text.
 */
export function effectJobError(error: EffectAttemptError): WireError {
  return { ...error, message: `The effect failed with ${error.code}.` };
}
