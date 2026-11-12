import { errors, type KeelwerkError } from '@keelwerk/core';

/** The one refusal of a presented key: an unknown, revoked, expired or foreign key and a wrong secret all get it. */
export function keyRefused(): KeelwerkError {
  return errors.unauthenticated('The API key was not accepted.');
}
