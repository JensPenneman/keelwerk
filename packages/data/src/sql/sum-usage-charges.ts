import type { UsageCharge } from '@keelwerk/core';

/**
 * One charge per dimension: deltas summed, the smallest non-null limit kept, net 0n dropped,
 * sorted by dimension (code-unit order: the tail's lock order).
 */
export function sumUsageCharges(charges: readonly UsageCharge[]): readonly UsageCharge[] {
  const sums = new Map<string, { delta: bigint; limit: bigint | null }>();
  for (const charge of charges) {
    const found = sums.get(charge.dimension);
    if (found === undefined) {
      sums.set(charge.dimension, { delta: charge.delta, limit: charge.limit });
      continue;
    }
    found.delta += charge.delta;
    if (charge.limit !== null && (found.limit === null || charge.limit < found.limit)) {
      found.limit = charge.limit;
    }
  }
  return [...sums]
    .filter(([, sum]) => sum.delta !== 0n)
    .map(([dimension, sum]) => ({ dimension, delta: sum.delta, limit: sum.limit }))
    .sort((left, right) =>
      left.dimension < right.dimension ? -1 : left.dimension > right.dimension ? 1 : 0,
    );
}
