import { timerKey } from './timer-key.ts';

/**
 * The stored key of the deadline timer of an external effect (7.9.5): `core.deadline:<effect id>`.
 * Its first half holds a dot, which no module id does (5.1), so no decision's `setTimer` or
 * `cancelTimer` (stored as `timerKey(<module id>, key)`) can equal it, the core module's included.
 * The one builder: `enqueueDeadlineTimer` sets it and `settleExternal` cancels it.
 */
export function deadlineTimerKey(effectId: string): string {
  return timerKey('core.deadline', effectId);
}
