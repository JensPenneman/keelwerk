import type { ReactionLineage } from './reaction-lineage.ts';

const maxDepth = 2_147_483_647;
const maxOriginLength = 64;

/**
 * A stored lineage as the kernel reads it, as a fresh `{ depth, origin }`; `undefined` (depth 0)
 * when it is absent or malformed, so a stored value never fails a read. Valid: a plain object,
 * `depth` an integer from 1 to 2,147,483,647, `origin` a text of 1 to 64 characters.
 */
export function reactionLineageOf(value: unknown): ReactionLineage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { depth, origin } = value as { readonly depth?: unknown; readonly origin?: unknown };
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 1 || depth > maxDepth) {
    return undefined;
  }
  if (typeof origin !== 'string' || origin.length < 1 || origin.length > maxOriginLength) {
    return undefined;
  }
  return { depth, origin };
}
