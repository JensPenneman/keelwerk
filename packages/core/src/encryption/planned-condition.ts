import type { Condition } from '../conditions/condition.ts';

/** A condition rewritten for the sealed columns of an entity. */
export interface PlannedCondition {
  /** What the adapter runs: personal comparisons on tags, the rest unchanged. */
  readonly condition: Condition;
  /** The rewrite touched a personal field: the original is re-evaluated on the unsealed rows. */
  readonly verify: boolean;
  /** A `startsWith` took the bounded scan of S-37: the rows the rest of the condition selects are unsealed and filtered in memory. */
  readonly scan: boolean;
  /** A truncated equality tag was used, so the database result may hold false matches. */
  readonly approximate: boolean;
}
