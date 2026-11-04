import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** Compares two strings or byte arrays in constant time for their length; differing lengths are unequal. */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const left = typeof a === 'string' ? new TextEncoder().encode(a) : a;
  const right = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  return left.length === right.length && nodeTimingSafeEqual(left, right);
}
