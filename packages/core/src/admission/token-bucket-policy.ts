import type { BucketCharge } from '../edge/bucket-demand.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** The limits one take runs under, with the cost filled in. */
export interface TokenBucketPolicy {
  readonly cost: number;
  readonly capacity: number;
  readonly refillPerSecond: number;
}

/**
 * The policy of a charge (section 12.2): one token unless the rule names a cost. A charge whose
 * numbers cannot describe a bucket is a defect of the rule that returned it, so it fails closed as
 * `internal` instead of being clamped.
 */
export function tokenBucketPolicy(charge: BucketCharge): TokenBucketPolicy {
  const cost = charge.cost ?? 1;
  const { capacity, refillPerSecond } = charge;
  const valid =
    Number.isFinite(cost) &&
    cost >= 0 &&
    Number.isFinite(capacity) &&
    capacity > 0 &&
    cost <= capacity &&
    Number.isFinite(refillPerSecond) &&
    refillPerSecond > 0;
  if (!valid) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message:
        'An admission rule returned a bucket without a positive capacity and refill rate, or with a cost below zero or above the capacity.',
    });
  }
  return { cost, capacity, refillPerSecond };
}
