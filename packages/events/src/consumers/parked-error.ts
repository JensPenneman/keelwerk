import type { StoredEvent, WireError } from '@keelwerk/core';
import { isErrorCode, isKeelwerkError } from '@keelwerk/core';

/**
 * What a parked stream records of a failure (D7): the kind and code of a taxonomy error, else
 * `internal` and `core.internal`, a fixed message, and the event's id as the request id. Never the
 * message of the cause, which can repeat a personal value; the cause goes to the process log.
 */
export function parkedError(cause: unknown, event: StoredEvent): WireError {
  const known = isKeelwerkError(cause) && isErrorCode(cause.code);
  return {
    kind: known ? cause.kind : 'internal',
    code: known ? cause.code : 'core.internal',
    message: 'The consumer failed on this event; the cause is in the process log.',
    retryable: false,
    requestId: event.eventId,
  };
}
