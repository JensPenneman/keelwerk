import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';

/** A `validation` error naming the argument at fault. */
export function invalidArgument(path: string, message: string): KeelwerkError {
  return errors.validation(message, { issues: [{ path: [path], message }] });
}
