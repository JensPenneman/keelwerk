import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { fanOutTenants } from './fan-out-tenants.ts';
import { nextTick } from './next-tick.ts';
import type { SchedulePassState } from './run-schedule-pass.ts';
import type { ScheduleLimits } from './schedule-limits.ts';
import { scheduleRowKey } from './schedule-row-key.ts';
import type { ScheduleSeed } from './schedule-seed.ts';

async function* seedsOf(
  context: RuntimeServiceContext,
  source: QueueSource,
  limits: ScheduleLimits,
  signal: AbortSignal,
): AsyncGenerator<ScheduleSeed> {
  for (const entry of source.registry.schedules.values()) {
    for await (const target of fanOutTenants(
      context.control,
      context.directory,
      source,
      entry,
      limits.pageSize,
      signal,
    )) {
      yield { entry, target };
    }
  }
}

/** Seeds at most `seedPerPass` scopes: each row's first tick is the first grid point after now. */
export async function seedSchedules(input: {
  readonly context: RuntimeServiceContext;
  readonly source: QueueSource;
  readonly limits: ScheduleLimits;
  readonly state: SchedulePassState;
  readonly now: Temporal.Instant;
}): Promise<void> {
  const { context, source, limits, state, now } = input;
  if (state.fanOut === undefined) {
    if (state.reseedAt !== undefined && Temporal.Instant.compare(now, state.reseedAt) < 0) return;
    state.fanOut = seedsOf(context, source, limits, state.abandon.signal);
  }
  let opened = 0;
  let examined = 0;
  while (opened < limits.seedPerPass && examined < limits.seedPerPass * 10) {
    examined += 1;
    const next = await state.fanOut.next().catch((error: unknown) => {
      // Abandoned at the stop deadline: the pass ends here and the ticker owns the report.
      if (state.abandon.signal.aborted) throw error;
      context.log.warn('the fan-out of the schedules failed; the next pass starts it again', {
        cause: error,
      });
      return { done: true as const, value: undefined };
    });
    if (next.done === true) {
      state.fanOut = undefined;
      state.reseedAt = now.add({ milliseconds: limits.reseedMs });
      return;
    }
    const { entry, target } = next.value;
    const key = scheduleRowKey(entry.ref, target.scopeId);
    if (state.seeded.has(key)) continue;
    opened += 1;
    try {
      await source.handle.adapter.unit(
        source.namespace,
        target.scope,
        (unit) => unit.jobs.schedules().upsert(entry.ref, nextTick(entry.every, now)),
        { signal: state.abandon.signal },
      );
      state.seeded.add(key);
    } catch (error) {
      if (state.abandon.signal.aborted) throw error;
      context.log.warn('a schedule row could not be seeded; the next fan-out tries again', {
        schedule: entry.ref,
        scope: target.scopeId,
        cause: error,
      });
    }
  }
  state.remaining = true;
}
