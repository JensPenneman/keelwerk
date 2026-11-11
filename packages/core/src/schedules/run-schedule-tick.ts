import { durationMs } from '../effects/duration-ms.ts';
import { sealJobInput } from '../effects/seal-job-input.ts';
import { validateEffectInput } from '../effects/validate-effect-input.ts';
import { errors } from '../errors/errors.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { StoredSchedule } from '../storage/stored-schedule.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import { nextTick } from './next-tick.ts';
import { scheduleCommandId } from './schedule-command-id.ts';
import type { ScheduleScope } from './schedule-scope.ts';
import { ScheduleTickError } from './schedule-tick-error.ts';
import { scheduleTickJob } from './schedule-tick-job.ts';
import { tickOfRow } from './tick-of-row.ts';

/**
 * One tick of one row in one scope unit (S-118): `claimTick(ref, scopeId, row.nextTick,
 * nextTick(every, now))`, then, only when claimed, the input (`entry.input({ at: tick, scope }) ??
 * {}`, validated) sealed under the tick's command id, and the job; the claim and the job commit
 * together, so a tick is neither lost nor doubled. The tick is the row's `nextTick` on the epoch
 * grid (`tickOfRow`): a tick that failed and is retried off the grid keeps its identity, so its
 * command id, job key, jitter and `at` never depend on when the retry ran. 'taken' when another process claimed the
 * tick. The input is built and validated before the unit opens; a throw there is a `ScheduleTickError`
 * of stage 'build', anything from the unit one of stage 'unit'. The next tick is the first grid
 * point after the runtime clock's now, so a long pause or a restored clock runs the schedule once.
 */
export async function runScheduleTick(input: {
  readonly source: QueueSource;
  readonly entry: ScheduleEntry;
  readonly row: StoredSchedule;
  readonly target: ScheduleScope;
  readonly build: { readonly id: string; readonly revision: number };
  readonly apiVersion: string;
  readonly clock: Clock;
  /** Aborted at the stop deadline or when the unit is too slow: the unit then ends without committing. */
  readonly signal?: AbortSignal;
  /** How long the unit may wait for its turn. */
  readonly timeoutMs?: number;
}): Promise<'enqueued' | 'taken'> {
  const { source, entry, row, target, clock } = input;
  const found = source.registry.actions.get(entry.invoke);
  if (found === undefined || found.kind !== 'command') {
    throw new ScheduleTickError(
      'build',
      errors.internal(`The schedule "${entry.ref}" invokes no command of the app.`),
    );
  }
  const action = found;
  let tick: Temporal.Instant;
  let validated: unknown;
  try {
    tick = tickOfRow(entry.every, row.nextTick);
    const raw = entry.input?.({ at: tick, scope: target.scope.level }) ?? {};
    validated = validateEffectInput(action.input, raw, `schedule "${entry.ref}"`);
  } catch (error) {
    throw new ScheduleTickError('build', error);
  }
  const commandId = scheduleCommandId(entry.ref, target.scopeId, durationMs(entry.every), tick);
  try {
    return await source.handle.adapter.unit(
      source.namespace,
      target.scope,
      async (unit) => {
        const now = clock.now();
        const claimed = await unit.jobs
          .schedules()
          .claimTick(entry.ref, target.scopeId, row.nextTick, nextTick(entry.every, now));
        if (!claimed) return 'taken' as const;
        const sealedInput = await sealJobInput(unit, commandId, action, validated);
        await unit.jobs.enqueue(
          scheduleTickJob({
            entry,
            action,
            target,
            tick,
            sealedInput,
            build: input.build,
            apiVersion: input.apiVersion,
            now,
          }),
        );
        return 'enqueued' as const;
      },
      {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      },
    );
  } catch (error) {
    throw new ScheduleTickError('unit', error);
  }
}
