import type { SchedulePassState } from './run-schedule-pass.ts';
import type { ScheduleLimits } from './schedule-limits.ts';

/** The options of a unit of the ticker: aborted at the stop deadline, and bounded in time (`unitTimeoutMs`). */
export function scheduleUnitOptions(
  state: Pick<SchedulePassState, 'abandon'>,
  limits: Pick<ScheduleLimits, 'unitTimeoutMs'>,
): { readonly timeoutMs: number; readonly signal: AbortSignal } {
  return {
    timeoutMs: limits.unitTimeoutMs,
    signal: AbortSignal.any([state.abandon.signal, AbortSignal.timeout(limits.unitTimeoutMs)]),
  };
}
