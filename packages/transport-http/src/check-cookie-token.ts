import { errors } from '@keelwerk/core';

/** Refuses a name that is not an RFC 6265 token. */
export function checkCookieToken(name: string): void {
  if (!/^[\w!#$%&'*+.^`|~-]+$/.test(name)) {
    throw errors.internal(`'${name}' is not a cookie name.`);
  }
}
