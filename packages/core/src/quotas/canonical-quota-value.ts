import type { QuotaLimit } from './quota-limit.ts';

/**
 * The stored text of a parsed limit, the only form a row or a backend's configuration keeps, so
 * its meaning never follows the friendly input forms: bytes and counts as plain digits, a rate as
 * `<count>/<milliseconds>ms`. `parseQuotaValue` reads it back to the same limit.
 */
export function canonicalQuotaValue(limit: QuotaLimit): string {
  if (limit.kind === 'rate') {
    return `${limit.capacity}/${Math.round((limit.capacity * 1000) / limit.refillPerSecond)}ms`;
  }
  return String(limit.value);
}
