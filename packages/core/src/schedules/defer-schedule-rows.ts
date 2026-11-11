import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { StoredSchedule } from '../storage/stored-schedule.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { holdScheduleRow } from './hold-schedule-row.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import type { ScheduleLimits } from './schedule-limits.ts';
import { scheduleNamespaceUnit } from './schedule-namespace-unit.ts';
import { scheduleRowKey } from './schedule-row-key.ts';
import { scheduleUnitOptions } from './schedule-unit-options.ts';
import { withinSignal } from './within-signal.ts';

/**
 * A row to move to `next` without a tick (a stale row, a suspended scope's), or to delete: its
 * backend or tenant is gone.
 */
export type ScheduleDeferral =
  | { readonly row: StoredSchedule; readonly next: Temporal.Instant }
  | { readonly row: StoredSchedule; readonly remove: true };

/**
 * Moves or deletes every collected row in one namespace unit of bounded time, after the active
 * backends were dispatched; when the unit fails the rows are held in memory so that the next window
 * does not read them again. A deleted row's seed is forgotten, so that a scope the directory
 * wrongly reported gone is seeded again by the next fan-out.
 */
export async function deferScheduleRows(
  context: RuntimeServiceContext,
  source: QueueSource,
  state: SchedulePassState,
  limits: ScheduleLimits,
  deferred: readonly ScheduleDeferral[],
): Promise<void> {
  if (deferred.length === 0) return;
  const options = scheduleUnitOptions(state, limits);
  try {
    await withinSignal(
      source.handle.adapter.unit(
        source.namespace,
        scheduleNamespaceUnit,
        async (unit) => {
          for (const item of deferred) {
            const { row } = item;
            if ('remove' in item) await unit.jobs.schedules().remove(row.scheduleId, row.scopeId);
            else {
              await unit.jobs
                .schedules()
                .claimTick(row.scheduleId, row.scopeId, row.nextTick, item.next);
            }
          }
        },
        options,
      ),
      options.signal,
    );
    for (const item of deferred) {
      if ('remove' in item) {
        state.seeded.delete(scheduleRowKey(item.row.scheduleId, item.row.scopeId));
      }
    }
  } catch (error) {
    if (state.abandon.signal.aborted) throw error;
    context.log.warn('schedule rows could not be deferred', {
      rows: deferred.length,
      cause: error,
    });
    const until = context.clock.now().add({ milliseconds: limits.retryMs });
    for (const { row } of deferred)
      holdScheduleRow(state, scheduleRowKey(row.scheduleId, row.scopeId), until);
  }
}
