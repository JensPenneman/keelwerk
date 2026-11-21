import type { ActionEntry } from '../registry/action-entry.ts';
import { isExemptFromAdmission } from './is-exempt-from-admission.ts';

/**
 * Whether the storage limits are left out of what the commit tail charges for one action in a unit
 * (12.2): the one place that decides it, for the tail of `attemptCommand` and for the inline
 * reactions of the same unit (`chargeStorage`). A charge declares no limit when
 * - `unitExempt` is true: the unit was opened for a command with a `prepare` step
 *   (`isUnitExemptFromTail`), which the storage limits checked at its admission. Everything the
 *   unit stores is charged and counted, whichever action charges it: the decision, its inline
 *   reactions, every synchronous command invoked in the unit at any depth and the inline reactions
 *   of those, so a command whose `prepare` step ran is never left without its decision by a
 *   storage limit. Its records are charged as always, and the counters may end above a limit.
 * - the action is of the core module (`isExemptFromAdmission`), per action and not per unit. As
 *   built no core action reaches the tail's limit: the core commands that `attemptCommand` runs are
 *   of the deployment scope, which charges nothing (`chargeStorage`), and `core.eraseSubject`, the
 *   one core command of the tenant scope, is asynchronous and its job starts the erasure without
 *   running a decision (`runActionJob`). The part is kept so that a core command of a tenant scope
 *   is never refused by a storage limit.
 * Otherwise the tail declares the limit: in a unit opened for a command without a `prepare` step,
 * the decision never takes a counter above it, and a command nested there declares it too.
 */
export function isExemptFromTail(
  action: Pick<ActionEntry, 'module'>,
  unitExempt: boolean,
): boolean {
  return unitExempt || isExemptFromAdmission(action);
}
