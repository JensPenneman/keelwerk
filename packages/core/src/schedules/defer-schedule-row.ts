import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { StoredSchedule } from '../storage/stored-schedule.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import type { ScheduleLimits } from './schedule-limits.ts';
import { scheduleNamespaceUnit } from './schedule-namespace-unit.ts';
import { scheduleUnitOptions } from './schedule-unit-options.ts';
import { withinSignal } from './within-signal.ts';

/** Moves one row's tick in a namespace unit of bounded time; false when the unit failed. */
export async function deferScheduleRow(input: {
  readonly context: RuntimeServiceContext;
  readonly source: QueueSource;
  readonly state: SchedulePassState;
  readonly limits: ScheduleLimits;
  readonly row: StoredSchedule;
  readonly next: Temporal.Instant;
}): Promise<boolean> {
  const { context, source, state, limits, row, next } = input;
  const options = scheduleUnitOptions(state, limits);
  try {
    await withinSignal(
      source.handle.adapter.unit(
        source.namespace,
        scheduleNamespaceUnit,
        (unit) => unit.jobs.schedules().claimTick(row.scheduleId, row.scopeId, row.nextTick, next),
        options,
      ),
      options.signal,
    );
    return true;
  } catch (error) {
    if (state.abandon.signal.aborted) throw error;
    context.log.warn('a schedule row could not be deferred', {
      schedule: row.scheduleId,
      scope: row.scopeId,
      cause: error,
    });
    return false;
  }
}
