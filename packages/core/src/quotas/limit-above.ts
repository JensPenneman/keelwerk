import type { QuotaLimit } from './quota-limit.ts';

/** Whether `limit` lets more through than `bound` (same kind): its value, or its capacity or refill for a rate. */
export function limitAbove(limit: QuotaLimit, bound: QuotaLimit): boolean {
  if (limit.kind === 'rate') {
    return (
      bound.kind === 'rate' &&
      (limit.capacity > bound.capacity || limit.refillPerSecond > bound.refillPerSecond)
    );
  }
  return bound.kind !== 'rate' && limit.value > bound.value;
}
