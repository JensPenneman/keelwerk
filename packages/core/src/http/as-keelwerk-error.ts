import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** An error as the taxonomy has it; anything else is `internal` and keeps its cause for the log only. */
export function asKeelwerkError(failure: unknown): KeelwerkError {
  return failure instanceof KeelwerkError
    ? failure
    : errors.internal('The request failed.', { cause: failure });
}
