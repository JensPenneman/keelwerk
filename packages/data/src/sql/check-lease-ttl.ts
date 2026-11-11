import { errors } from '@keelwerk/core';

/** A lease time-to-live: an integer of at least `least` milliseconds, else `core.validation`. */
export function checkLeaseTtl(ttlMs: number, least: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs < least) {
    throw errors.validation(
      least === 0
        ? 'a lease time-to-live is a whole number of milliseconds, 0 or more'
        : 'a lease time-to-live is a whole number of milliseconds above 0',
    );
  }
}
