import { headApiVersion } from '../api-versions/head-api-version.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { ServedApp } from '../runtime/served-app.ts';
import type { StoredSchedule } from '../storage/stored-schedule.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { deferScheduleRow } from './defer-schedule-row.ts';
import { holdScheduleRow } from './hold-schedule-row.ts';
import { nextTick } from './next-tick.ts';
import { provisionScheduleGroup } from './provision-schedule-group.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import { runScheduleTick } from './run-schedule-tick.ts';
import type { ScheduleLimits } from './schedule-limits.ts';
import { scheduleRowKey } from './schedule-row-key.ts';
import type { ScheduleScope } from './schedule-scope.ts';
import { ScheduleTickError } from './schedule-tick-error.ts';
import { scheduleUnitOptions } from './schedule-unit-options.ts';
import type { UnbuiltSchedule } from './unbuilt-schedule.ts';
import { withinSignal } from './within-signal.ts';

const minInstant = (a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant =>
  Temporal.Instant.compare(a, b) <= 0 ? a : b;

/** A row of a schedule the registry knows, with the scope it ticks in. */
export interface DueTick {
  readonly entry: ScheduleEntry;
  readonly row: StoredSchedule;
  readonly target: ScheduleScope;
}

/**
 * One backend's rows in order, one by one: a failing tenant defers its own tick and the next row
 * goes on. The task keeps its slot for `backendBudgetMs` of wall time at most, and each of its units
 * for `unitTimeoutMs`: past the budget it takes no further row and leaves the rest due (the state
 * asks for another pass), so a backend whose units are slow gives its slot back within a bounded
 * time and never starves the other backends of the namespace.
 */
export async function tickBackend(input: {
  readonly context: RuntimeServiceContext;
  readonly source: QueueSource;
  readonly served: ServedApp;
  readonly limits: ScheduleLimits;
  readonly state: SchedulePassState;
  readonly backendId: string;
  readonly ticks: readonly DueTick[];
  /** The pass's tally of ticks whose input could not be built, by schedule; the pass logs it once. */
  readonly unbuilt: Map<string, UnbuiltSchedule>;
}): Promise<void> {
  const { context, source, served, limits, state, ticks, unbuilt } = input;
  const { clock, log } = context;
  const apiVersion = headApiVersion({ head: served.head, api: served.source.api });
  const budgetEnd = performance.now() + limits.backendBudgetMs;
  for (const tick of ticks) {
    if (state.stopping) return;
    if (performance.now() >= budgetEnd) {
      state.remaining = true;
      return;
    }
    const { entry, row, target } = tick;
    const key = scheduleRowKey(entry.ref, row.scopeId);
    try {
      await provisionScheduleGroup({ source, entry, backendId: input.backendId, state, limits });
      const options = scheduleUnitOptions(state, limits);
      await withinSignal(
        runScheduleTick({
          source,
          entry,
          row,
          target,
          build: context.build,
          apiVersion,
          clock,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        }),
        options.signal,
      );
    } catch (error) {
      // Work abandoned at the stop deadline writes nothing and is not retried; the ticker logged it once.
      if (state.abandon.signal.aborted) return;
      const now = clock.now();
      const stage = error instanceof ScheduleTickError ? error.stage : 'unit';
      const cause = error instanceof ScheduleTickError ? error.cause : error;
      const fields = {
        schedule: entry.ref,
        scope: row.scopeId,
        code: isKeelwerkError(cause) ? cause.code : undefined,
        cause,
      };
      const held = now.add({ milliseconds: limits.retryMs });
      if (stage === 'build') {
        const seen = unbuilt.get(entry.ref);
        if (seen === undefined) {
          unbuilt.set(entry.ref, { count: 1, scope: row.scopeId, code: fields.code, cause });
        } else {
          seen.count += 1;
        }
        const next = nextTick(entry.every, now);
        if (!(await deferScheduleRow({ context, source, state, limits, row, next }))) {
          holdScheduleRow(state, key, held);
        }
        continue;
      }
      log.warn('a schedule tick failed in its unit and is tried again later', fields);
      // The retry lies off the grid; its tick is the grid point before it (`tickOfRow`).
      const next = minInstant(nextTick(entry.every, now), held);
      if (!(await deferScheduleRow({ context, source, state, limits, row, next }))) {
        holdScheduleRow(state, key, held);
      }
    }
  }
}
