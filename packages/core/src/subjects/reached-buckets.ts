import { askReaches } from './ask-reaches.ts';
import { erasureReachPoint } from './erasure-reach-point.ts';
import { namedBuckets } from './named-buckets.ts';
import type { ReachErasureInput } from './reach-erasure-input.ts';

/**
 * The stored names of the buckets that the fillers name by the subject alone, for the purge of the
 * principals after the shred: the addresses are not readable any more, so only the names that the
 * subject itself makes. Nothing is written; the caller forgets them in its unit.
 */
export async function reachedBuckets(input: ReachErasureInput): Promise<readonly string[]> {
  if ((input.source.registry.fills.get(erasureReachPoint) ?? []).length === 0) return [];
  return askReaches(input, (reaches) => namedBuckets(input, reaches, []));
}
