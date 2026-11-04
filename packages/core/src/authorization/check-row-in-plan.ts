import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { DroppedRow } from './dropped-row.ts';
import type { Plan } from './plan.ts';
import type { RowEnvironment } from './row-environment.ts';
import type { RowMatcher } from './row-matcher.ts';

/** What the shape stage hands `checkRowInPlan`. */
export interface RowInPlanInput {
  readonly plan: Plan;
  readonly row: StorageRow;
  readonly environment: RowEnvironment;
  /**
   * Built with `createRowMatcher`: it carries the personal-field normalisers and answers the
   * plan's relation quantifiers, so it is required (`plainRowMatcher()` only for plain entities).
   */
  readonly matches: RowMatcher;
  /** Called in production with the row that was dropped; a drop is always logged (section 8.4). */
  readonly onDropped: (dropped: DroppedRow) => void;
}

/**
 * The shape stage's backstop (section 8.4): a row the caller's read plan does not select never
 * leaves the invoker. Returns whether to keep the row. Development and tests throw
 * `core.row_outside_plan`; production returns false after reporting the action, the row id and the
 * rule ids, so the bug is found without a leak. It also guards personal-field tag collisions
 * (section 14.7.9.4): the plan's condition is evaluated on the row in memory.
 */
export function checkRowInPlan(input: RowInPlanInput): boolean {
  const { plan, row } = input;
  if (plan.kind === 'always') return true;
  const { matches } = input;
  if (plan.kind === 'conditional' && matches(plan.where, row)) return true;
  const dropped: DroppedRow = {
    action: plan.action,
    entity: plan.entity,
    rowId: String(row.id),
    rules: plan.rules,
  };
  if (input.environment === 'production') {
    input.onDropped(dropped);
    return false;
  }
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.row_outside_plan',
    message: `A row of ${plan.entity} fell outside the read plan of ${plan.action}.`,
    details: dropped,
  });
}
