import { newUuidV7 } from '@keelwerk/core';

/** The id of one request: a UUIDv7, echoed as `x-request-id`; a client-sent id is never trusted. */
export function requestId(): string {
  return newUuidV7();
}
