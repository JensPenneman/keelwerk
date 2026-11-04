import type { Condition } from '../conditions/condition.ts';
import type { RuleMatch } from '../errors/rule-match.ts';
import type { PlanClause } from './plan-clause.ts';
import type { PlanOperation } from './plan-operation.ts';

/**
 * What a principal may do with an entity through an action (section 8.4): `always`, `never`, or
 * `conditional` on `where`. The clauses carry the per-rule conditions the item check and the masks
 * need; the selection `where` is what the data layer compiles.
 */
export interface Plan {
  readonly kind: 'always' | 'never' | 'conditional';
  readonly operation: PlanOperation;
  /** 'accounts.profile'. */
  readonly entity: string;
  /** The action reference the plan was compiled for. */
  readonly action: string;
  /**
   * The rows the action may select (reads, transitions) or produce (creates): some allow's `where`
   * and no deny without `check`.
   */
  readonly where: Condition;
  /** Allow rules in effect, by rule id. */
  readonly allows: readonly PlanClause[];
  /** Deny rules that decide on rows (those without a field list). */
  readonly denies: readonly PlanClause[];
  /** Deny rules with a field list: they hide or forbid those fields and never deny the row. */
  readonly fieldDenies: readonly PlanClause[];
  /** The maskable fields of the entity. */
  readonly maskable: readonly string[];
  /** The rules that shaped the plan; for `never`, those that denied or would have had to allow. */
  readonly rules: readonly RuleMatch[];
  /** `never` by a deny rule: its reason. */
  readonly reason: string | undefined;
}
