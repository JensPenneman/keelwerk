import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';

/** The reason a signal carries once the attempt it belongs to has ended: what a late fetch or reveal is refused with. */
export function attemptEnded(): KeelwerkError {
  return errors.unavailable('The attempt of this effect has ended.');
}
