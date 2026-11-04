import type { Condition } from '../conditions/condition.ts';

/** One rule's contribution to a plan: its conditions for the principal at hand. */
export interface PlanClause {
  readonly rule: string;
  /** Reads and transitions: the row acted on. Creates: the new row (`check ?? where`). */
  readonly where: Condition;
  /** Transitions: the row produced; `null` when the rule has none. */
  readonly check: Condition | null;
  /** `null`: the rule lists no fields. */
  readonly fields: ReadonlySet<string> | null;
  readonly reason: string | undefined;
}
