import { errors } from '../errors/errors.ts';
import { coreError } from '../http/core-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Job } from '../jobs/job.ts';
import { completeJob } from '../worker/complete-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { attemptErrorOf } from './attempt-error-of.ts';
import { settleKeepingContinuation } from './settle-keeping-continuation.ts';

/**
 * Runs a deadline job (7.9.5): in one unit of the job's scope, settles a still `requested` effect
 * `failed` with `core.effect_deadline` and completes the job; a settled or missing effect completes
 * it `succeeded`. The settle goes through `settleKeepingContinuation` and `settleEffect`, which
 * re-read the effect row under its lock, so a settle that races the deadline has one winner: the
 * loser finds a settled row and writes nothing. A settle that wins cancels this job's key, which
 * deletes a running attempt: the completion here then finds its lease gone and the unit rolls back
 * having written nothing.
 */
export function runDeadlineJob(job: Job, context: RunJobContext): Promise<void> {
  const { stored } = job;
  if (!('effectDeadline' in stored.run)) {
    return Promise.reject(errors.internal('A deadline job carries no effect.'));
  }
  const { effectDeadline: effectId } = stored.run;
  const { source, worker, writer, clock } = context;
  const { registry } = source;
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  return source.handle.adapter.unit(source.namespace, stored.scope, async (unit) => {
    if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
    const held = { attempt: stored.attempt, worker };
    const row = await unit.rows.findOne(descriptor, {
      where: { op: 'eq', field: 'id', value: effectId },
    });
    if (row !== undefined && row.status === 'requested') {
      const entry = registry.effects.get(String(row.type));
      await settleKeepingContinuation(
        unit,
        {
          registry,
          entry,
          row,
          cause: stored,
          writer,
          clock,
          ...(entry === undefined ? { continuation: 'skip' as const } : {}),
        },
        () =>
          Promise.resolve({
            status: 'failed',
            error: attemptErrorOf(coreError('core.effect_deadline'), newUuidV7(), new Set()),
          }),
        Number(row.attempts ?? 0),
      );
    }
    await completeJob(unit, held, { kind: 'succeeded' });
  });
}
