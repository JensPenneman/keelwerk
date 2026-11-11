import type { FlagVariant } from './flag-targeting.ts';

/** The name of a served value: the typed `variant`, else `String(value)`. */
export function variantOf(served: FlagVariant): string {
  return served.variant ?? String(served.value);
}
