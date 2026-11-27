import { openEffectInput } from '../effects/open-effect-input.ts';
import { errors } from '../errors/errors.ts';
import { coreError } from '../http/core-error.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { completeJob } from '../worker/complete-job.ts';
import { countKeyDestroyedJob } from '../worker/count-key-destroyed-job.ts';
import { defaultHeartbeatSeconds } from '../worker/default-heartbeat-seconds.ts';
import { jobLeaseLost } from '../worker/job-lease-lost.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { decodeShapeValue } from '../write-path/decode-shape-value.ts';
import { abandonOnLostLease } from './abandon-on-lost-lease.ts';
import { attemptErrorOf } from './attempt-error-of.ts';
import { attemptRecordBound } from './attempt-record-bound.ts';
import { declaredErrorCodesOf } from './declared-error-codes-of.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import { effectJobError } from './effect-job-error.ts';
import { latestAttemptRecords } from './latest-attempt-records.ts';
import { recordAttempt } from './record-attempt.ts';
import { settleKeepingContinuation } from './settle-keeping-continuation.ts';

/** What the begin unit answers: a `BeganAttempt`, or that it settled an effect whose key was destroyed. */
type BeginUnitResult = BeganAttempt | { readonly kind: 'erased' };

/** How the begin unit ended: the job is complete, or the executor runs with `input`. */
export type BeganAttempt =
  | { readonly kind: 'finished' }
  | {
      readonly kind: 'run';
      readonly input: Readonly<Record<string, unknown>>;
      readonly startedAt: string;
      /** The attempts that started, this one included. */
      readonly started: number;
    };

/**
 * The first unit of an attempt (D2, D1): in one read-write unit of the job's scope it reads the
 * effect (under its row lock) and its attempt records and decides. A missing effect fails the job; an effect that is
 * no longer `requested` completes the job; an earlier attempt with a start record and no end record
 * may have acted, so the effect settles `abandoned` (`core.effect_outcome_unknown`) and the executor
 * is not called; no executor, a configuration that cannot be read, or an input member whose key
 * is gone settle `failed` (`core.key_destroyed` for a destroyed key, `core.forbidden` for an
 * envelope sealed for another effect). Otherwise the personal input members are opened against their binding,
 * the lease is fenced (`jobs.heartbeat`, `core.job_lease_lost` when it is gone) and the start
 * record of this attempt is written, so a crash after this unit leaves an attempt that started.
 * The info line and the count of an effect that ended for a destroyed key are written once, after
 * the unit has committed: when the commit fails or the lease is lost, the next taker writes them.
 */
export async function beginEffectAttempt(
  context: RunJobContext,
  target: EffectAttemptJob,
  config: { readonly error: unknown } | { readonly error?: undefined },
): Promise<BeganAttempt> {
  const { stored, registry, effectId, executor, entry, requestId } = target;
  const { source, worker, writer, clock } = context;
  const held = { attempt: stored.attempt, worker };
  const attempt = stored.attempt.attempt;
  const declared = declaredErrorCodesOf(registry, entry?.module);
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  const limits = await context.quotas?.fresh();
  const began: BeginUnitResult = await source.handle.adapter.unit(
    source.namespace,
    stored.scope,
    async (unit): Promise<BeginUnitResult> => {
      if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
      // Under the row's lock: an erasure that settles the effect commits first or waits for this unit.
      const row: StorageRow | undefined = await unit.rows.findOne(descriptor, {
        where: { op: 'eq', field: 'id', value: effectId },
        forUpdate: true,
      });
      if (row === undefined) {
        await completeJob(unit, held, {
          kind: 'failed',
          error: effectJobError(
            attemptErrorOf(
              errors.internal('The effect of this job no longer exists.'),
              requestId,
              declared,
            ),
          ),
        });
        return { kind: 'finished' };
      }
      if (row.status !== 'requested') {
        await completeJob(unit, held, { kind: 'succeeded' });
        return { kind: 'finished' };
      }
      const { records, started: startedAttempts } = await latestAttemptRecords(
        unit,
        effectId,
        attemptRecordBound,
      );
      const { open } = abandonOnLostLease(records, attempt);
      const started = startedAttempts.size;
      const finish = async (
        status: 'failed' | 'abandoned',
        error: unknown,
        attempts: number,
      ): Promise<BeginUnitResult> => {
        const projection = attemptErrorOf(error, requestId, declared);
        // The continuation runs unless it is gone or no longer fits (an effect the registry no longer
        // holds has none to run): the effect then settles from what its row holds, without it.
        await settleKeepingContinuation(
          unit,
          {
            registry,
            entry,
            row,
            cause: stored,
            writer,
            clock,
            limits,
            ...(entry === undefined ? { continuation: 'skip' as const } : {}),
          },
          () => Promise.resolve({ status, error: projection }),
          attempts,
        );
        await completeJob(unit, held, { kind: 'failed', error: effectJobError(projection) });
        return { kind: 'finished' };
      };
      if (open !== undefined) {
        return finish('abandoned', coreError('core.effect_outcome_unknown'), started);
      }
      if (executor === undefined || entry === undefined) {
        return finish('failed', errors.internal('No executor performs this effect.'), started);
      }
      if (config.error !== undefined) return finish('failed', config.error, started);
      const stored_ = row.input;
      const opened = await openEffectInput(
        unit,
        entry,
        effectId,
        typeof stored_ === 'object' && stored_ !== null
          ? (stored_ as Readonly<Record<string, unknown>>)
          : {},
      );
      if (opened.mismatched.length > 0) {
        // The key exists but the envelope was sealed for another effect: an integrity failure, no erasure.
        return finish(
          'failed',
          coreError('core.forbidden', {
            message: 'A personal input member of the effect can no longer be opened.',
          }),
          started,
        );
      }
      if (opened.erased.length > 0) {
        // The key of a personal member is destroyed: the effect ends failed and never stays requested.
        await finish('failed', coreError('core.key_destroyed'), started);
        return { kind: 'erased' };
      }
      let input: Readonly<Record<string, unknown>>;
      try {
        input = decodeShapeValue(entry.input, entry.module, opened.input) as Readonly<
          Record<string, unknown>
        >;
      } catch {
        return finish(
          'failed',
          errors.internal('The stored input of the effect does not fit its fields.'),
          started,
        );
      }
      const heartbeatMs = (stored.heartbeatSeconds ?? defaultHeartbeatSeconds) * 1000;
      const live = await unit.jobs.heartbeat([stored.attempt], worker, 3 * heartbeatMs);
      if (live.length === 0) throw jobLeaseLost();
      const startedAt = clock.now().toString();
      await recordAttempt(unit, registry, effectId, {
        process: worker,
        build: writer.build.id,
        attempt,
        startedAt,
      });
      return { kind: 'run', input, startedAt, started: started + 1 };
    },
  );
  if (began.kind !== 'erased') return began;
  context.log.info(
    'an effect ended without running: the data subject of a personal member was erased',
    { effect: effectId, queue: stored.queue },
  );
  countKeyDestroyedJob(stored.queue, context.meter);
  return { kind: 'finished' };
}
