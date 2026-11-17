import { neverCondition } from '../authorization/never-condition.ts';
import type { Condition } from '../conditions/condition.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';

/**
 * The rows of `core.effect` a principal requested (8.5: a principal is the pair): `neverCondition`
 * when `ref` is null or absent, else `and(eq principalResolver, eq principalId)`. A row with both
 * columns null (no submitter) matches no principal.
 */
export function submitterCondition(principal: {
  readonly ref?: PrincipalRef | null | undefined;
}): Condition {
  const { ref } = principal;
  if (ref === null || ref === undefined) return neverCondition;
  return {
    op: 'and',
    conditions: [
      { op: 'eq', field: 'principalResolver', value: ref.resolver },
      { op: 'eq', field: 'principalId', value: ref.principalId },
    ],
  };
}
