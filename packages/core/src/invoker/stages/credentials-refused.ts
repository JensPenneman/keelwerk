import { errors } from '../../errors/errors.ts';
import type { KeelwerkError } from '../../errors/keelwerk-error.ts';

/**
 * The one refusal of a credential that no resolver accepts: `core.unauthenticated` with a fixed
 * message, so a caller learns nothing of why. `openSession` gives it to a fresh open for a
 * principal that has expired.
 */
export function credentialsRefused(): KeelwerkError {
  return errors.unauthenticated('The credentials were not accepted.');
}
