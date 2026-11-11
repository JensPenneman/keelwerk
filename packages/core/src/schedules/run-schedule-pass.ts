import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { ServedApp } from '../runtime/served-app.ts';
import type { StoredSchedule } from '../storage/stored-schedule.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { deferScheduleRows, type ScheduleDeferral } from './defer-schedule-rows.ts';
import { nextTick } from './next-tick.ts';
import type { ScheduleLimits } from './schedule-limits.ts';
import { scheduleNamespaceUnit } from './schedule-namespace-unit.ts';
import { scheduleRowKey } from './schedule-row-key.ts';
import { scheduleScopeOf } from './schedule-scope-of.ts';
import type { ScheduleSeed } from './schedule-seed.ts';
import { scheduleUnitOptions } from './schedule-unit-options.ts';
import { seedSchedules } from './seed-schedules.ts';
import type { DueTick } from './tick-backend.ts';
import { tickBackend } from './tick-backend.ts';
import type { UnbuiltSchedule } from './unbuilt-schedule.ts';
import { withinSignal } from './within-signal.ts';

/** What one ticker keeps between passes of one namespace. */
export interface SchedulePassState {
  /** `${ref}\u0000${scopeId}` of the rows this process seeded, and `group\u0000${ref}\u0000${backendId}` of the groups it provisioned. */
  readonly seeded: Set<string>;
  /** Row key to the instant before which the row is not tried again (a failed deferral); at most 1000. */
  readonly held: Map<string, Temporal.Instant>;
  /** The backend ids ticking now. */
  readonly busy: Set<string>;
  /** The backend tasks in flight, each with its own catch. */
  readonly running: Set<Promise<void>>;
  /** The seeding cursor over the scopes of every schedule. */
  fanOut: AsyncIterator<ScheduleSeed> | undefined;
  reseedAt: Temporal.Instant | undefined;
  /** The key of the last due row the previous read answered: the next read starts after it, and wraps to the start when a read comes back short. */
  cursor: Pick<StoredSchedule, 'nextTick' | 'scopeId' | 'scheduleId'> | undefined;
  /** The round-robin start over backends. */
  offset: number;
  /** True when the last pass left work for another pass: due rows it did not dispatch, or scopes it did not seed. */
  remaining: boolean;
  /** Set once the ticker stops: tasks start no further row. */
  stopping: boolean;
  /** Aborted at the stop deadline: a unit of this ticker that is still open then writes nothing. */
  readonly abandon: AbortController;
}

/**
 * One pass over one app namespace (9.5.6): seeds at most `seedPerPass` scopes (`upsert(ref,
 * nextTick(every, now))` in each scope's unit); reads `due(now, dueLimit + held.size, cursor)` in a read-only
 * namespace unit, from the key after the last row the previous pass read (a keyset cursor, so that
 * a backend with thousands of due rows never fills every window; a short read wraps to the start);
 * drops held rows and rows of busy backends; groups the rest by backend, round-robin
 * from `offset`, at most `perBackend` rows per backend and `concurrency` backends at once, each
 * backend's rows in order in a task of its own (`state.running`) that the next pass does not await.
 * A row of a schedule this build does not know, or of a scope of another app, namespace or
 * schedule level, is
 * claimed `staleMs` ahead and makes no job; a row whose backend or tenant the directory reports gone
 * is deleted (`ScheduleStore.remove`); a suspended scope's tick is claimed to its next grid point
 * and makes no job; all such claims and deletions run in one namespace unit after the active
 * backends were dispatched. A backend's task keeps its slot for `backendBudgetMs` at most and its
 * units `unitTimeoutMs` each. A tick whose input
 * cannot be built is skipped (claimed to the next grid point, logged once per schedule and pass
 * with the total count, the first scope and the code); a tick whose unit failed is claimed to the earlier of the next grid point and
 * `retryMs` ahead, and when that claim fails too the row is held in memory for `retryMs`. One
 * backend's failing tenants therefore never delay another backend's. Answers when the due read, the
 * stale claims and the dispatch are done.
 */
export async function runSchedulePass(input: {
  readonly context: RuntimeServiceContext;
  readonly source: QueueSource;
  readonly served: ServedApp;
  readonly limits: ScheduleLimits;
  readonly state: SchedulePassState;
}): Promise<void> {
  const { context, source, served, limits, state } = input;
  const { clock, log, directory } = context;
  const now = clock.now();
  state.remaining = false;
  await seedSchedules({ context, source, limits, state, now });
  const window = limits.dueLimit + state.held.size;
  const readDue = (after: SchedulePassState['cursor']): Promise<readonly StoredSchedule[]> => {
    const options = scheduleUnitOptions(state, limits);
    return withinSignal(
      source.handle.adapter.unit(
        source.namespace,
        scheduleNamespaceUnit,
        (unit) => unit.jobs.schedules().due(now, window, after),
        { ...options, readOnly: true },
      ),
      options.signal,
    );
  };
  // A read that starts after the cursor and comes back short does not see the rows before the
  // cursor, which the previous pass may have left due: one more pass from the start settles it.
  let fromCursor = state.cursor !== undefined;
  let rows = await readDue(state.cursor);
  if (rows.length === 0 && fromCursor) {
    rows = await readDue(undefined);
    fromCursor = false;
  }
  const last = rows.at(-1);
  state.cursor =
    last === undefined || rows.length < window
      ? undefined
      : { nextTick: last.nextTick, scopeId: last.scopeId, scheduleId: last.scheduleId };
  const byBackend = new Map<string, DueTick[]>();
  const deferred: ScheduleDeferral[] = [];
  let truncated = state.cursor !== undefined || fromCursor;
  for (const row of rows) {
    const key = scheduleRowKey(row.scheduleId, row.scopeId);
    const heldUntil = state.held.get(key);
    if (heldUntil !== undefined) {
      if (Temporal.Instant.compare(heldUntil, now) > 0) continue;
      state.held.delete(key);
    }
    const entry = source.registry.schedules.get(row.scheduleId);
    const stale = { row, next: now.add({ milliseconds: limits.staleMs }) };
    if (entry === undefined) {
      // Another build, rolling in, may know this schedule and has seeded the row in its own memory:
      // the row stays, looked at again later.
      log.warn('a schedule row names a schedule this build does not know and is looked at later', {
        schedule: row.scheduleId,
        scope: row.scopeId,
      });
      deferred.push(stale);
      continue;
    }
    let target: Awaited<ReturnType<typeof scheduleScopeOf>>;
    try {
      target = await scheduleScopeOf(directory, source, entry, row.scopeId, state.abandon.signal);
    } catch (error) {
      // Abandoned at the stop deadline: the pass ends here and the ticker owns the report.
      if (state.abandon.signal.aborted) throw error;
      log.warn('the scope of a schedule row could not be read; the row stays due', {
        schedule: row.scheduleId,
        scope: row.scopeId,
        cause: error,
      });
      continue;
    }
    if (target === 'gone') {
      log.info('a schedule row of a backend or tenant that no longer exists is deleted', {
        schedule: row.scheduleId,
        scope: row.scopeId,
      });
      deferred.push({ row, remove: true });
      continue;
    }
    if (target === 'elsewhere') {
      log.warn(
        'a schedule row names a scope of another app, namespace or schedule level and is looked at later',
        {
          schedule: row.scheduleId,
          scope: row.scopeId,
        },
      );
      deferred.push(stale);
      continue;
    }
    if (!target.active) {
      deferred.push({ row, next: nextTick(entry.every, now) });
      continue;
    }
    if (state.busy.has(target.backendId)) continue;
    const ticks = byBackend.get(target.backendId) ?? [];
    ticks.push({ entry, row, target });
    byBackend.set(target.backendId, ticks);
  }
  const backends = [...byBackend.keys()].toSorted();
  const start = backends.length === 0 ? 0 : state.offset % backends.length;
  const ordered = [...backends.slice(start), ...backends.slice(0, start)];
  let slots = limits.concurrency - state.busy.size;
  let started = 0;
  const unbuilt = new Map<string, UnbuiltSchedule>();
  const tasks: Promise<void>[] = [];
  for (const backendId of ordered) {
    const ticks = byBackend.get(backendId) ?? [];
    if (ticks.length > limits.perBackend) truncated = true;
    if (slots <= 0) {
      truncated = true;
      continue;
    }
    slots -= 1;
    started += 1;
    state.busy.add(backendId);
    const task: Promise<void> = tickBackend({
      context,
      source,
      served,
      limits,
      state,
      backendId,
      ticks: ticks.slice(0, limits.perBackend),
      unbuilt,
    })
      .catch((error: unknown) => {
        // After the stop the ticker logs the abandoned work once; a late failure adds nothing.
        if (!state.stopping)
          log.error('a schedule task failed', { backend: backendId, cause: error });
      })
      .finally(() => {
        state.busy.delete(backendId);
        state.running.delete(task);
      });
    state.running.add(task);
    tasks.push(task);
  }
  // The tasks of this pass are the only ones that add to the tally: one line for each schedule once they all settled.
  void Promise.allSettled(tasks).then(() => {
    for (const [schedule, skipped] of unbuilt) {
      log.error('schedule ticks were skipped: their input could not be built', {
        schedule,
        count: skipped.count,
        scope: skipped.scope,
        code: skipped.code,
        cause: skipped.cause,
      });
    }
  });
  state.offset += Math.max(1, started);
  await deferScheduleRows(context, source, state, limits, deferred);
  if (truncated) state.remaining = true;
}
