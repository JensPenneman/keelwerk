import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** Seconds a refused caller is told to wait; a job of a held tenant is tried again after as long. */
const retryAfterSeconds = 1;

/**
 * The refusal of a held tenant (14.7.6): `core.unavailable`, retryable, with a `retryAfter`. It is
 * a class of its own so the worker tells it from any other `unavailable` before the failure is
 * projected for storage: a job refused by the hold is tried again without using up an attempt.
 */
export class RestoreHoldRefusal extends KeelwerkError {
  constructor() {
    super({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'This tenant is being restored: an erasure is run again before it is served.',
      retryAfter: retryAfterSeconds,
    });
  }
}
