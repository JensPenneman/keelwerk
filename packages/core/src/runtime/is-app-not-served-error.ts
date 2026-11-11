import type { AppNotServedError } from './app-not-served-error.ts';

/** True for an `AppNotServedError`, also one made by another copy of the core (a duplicated install). */
export function isAppNotServedError(value: unknown): value is AppNotServedError {
  return (
    value instanceof RangeError &&
    value.name === 'AppNotServedError' &&
    typeof (value as RangeError & { readonly appId?: unknown }).appId === 'string'
  );
}
