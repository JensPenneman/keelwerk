import { errors } from '@keelwerk/core';
import { maxPasswordLength } from './max-password-length.ts';

/**
 * Refuses a new password shorter than `min` or longer than `maxPasswordLength`, counted in code points,
 * with no composition rule (decision 479). Throws `core.validation` with one issue at `field`.
 */
export function checkPasswordLength(
  password: string,
  min: number,
  field: 'password' | 'newPassword',
): void {
  const length = [...password].length;
  const message =
    length < min
      ? `The password must have at least ${min} characters.`
      : length > maxPasswordLength
        ? `The password must have at most ${maxPasswordLength} characters.`
        : undefined;
  if (message === undefined) return;
  throw errors.validation(message, { issues: [{ path: [field], message }] });
}
