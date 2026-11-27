import { errors } from '../errors/errors.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import type { ScheduleLimits } from './schedule-limits.ts';

/**
 * The options of a unit of the ticker: aborted at the stop deadline, and bounded in time
 * (`unitTimeoutMs`); a unit past its limit is aborted with `core.unavailable`, the time-out its cause.
 */
export function scheduleUnitOptions(
  state: Pick<SchedulePassState, 'abandon'>,
  limits: Pick<ScheduleLimits, 'unitTimeoutMs'>,
): { readonly timeoutMs: number; readonly signal: AbortSignal } {
  const late = new AbortController();
  const timeout = AbortSignal.timeout(limits.unitTimeoutMs);
  timeout.addEventListener(
    'abort',
    () => {
      late.abort(
        errors.unavailable(
          `A unit of the schedule ticker did not end within ${limits.unitTimeoutMs} ms.`,
          { cause: timeout.reason },
        ),
      );
    },
    { once: true },
  );
  return {
    timeoutMs: limits.unitTimeoutMs,
    signal: AbortSignal.any([state.abandon.signal, late.signal]),
  };
}
