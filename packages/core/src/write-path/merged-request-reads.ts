import type { DecisionRequest } from '../events/decision-request.ts';

/**
 * What `prepare` and `decide` read of the request are one record: each member either read, and
 * `decide`'s value of a member wins (both read the same request, so it is the same value).
 */
export function mergedRequestReads(
  prepared: DecisionRequest | undefined,
  decided: DecisionRequest | undefined,
): DecisionRequest | undefined {
  if (prepared === undefined) return decided;
  if (decided === undefined) return prepared;
  return { ...prepared, ...decided };
}
