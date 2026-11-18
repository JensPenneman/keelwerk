import type { KweEnvelope } from '../keys/kwe-envelope.ts';

/**
 * Whether a value has the shape of the `$kwe` envelope of a personal value in the chain (14.7.4),
 * version 1 or 2.
 */
export function isKweEnvelope(value: unknown): value is KweEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Reflect.get(value, '$kwe') === 1 || Reflect.get(value, '$kwe') === 2) &&
    typeof Reflect.get(value, 'k') === 'string' &&
    typeof Reflect.get(value, 'n') === 'string' &&
    typeof Reflect.get(value, 'c') === 'string'
  );
}
