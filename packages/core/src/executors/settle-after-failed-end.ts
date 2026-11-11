import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { errors } from '../errors/errors.ts';
import { coreError } from '../http/core-error.ts';
import { completeJob } from '../worker/complete-job.ts';
import { jobLeaseLost } from '../worker/job-lease-lost.ts';
import { jobOutcomeOfError } from '../worker/job-outcome-of-error.ts';
import { retryDelay } from '../worker/retry-delay.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { settleJobAttempt } from '../worker/settle-job-attempt.ts';
import { attemptErrorOf } from './attempt-error-of.ts';
import type { BeganAttempt } from './begin-effect-attempt.ts';
import { declaredErrorCodesOf } from './declared-error-codes-of.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import { effectJobError } from './effect-job-error.ts';
import type { AttemptResult } from './end-effect-attempt.ts';
import { isLeaseLost } from './is-lease-lost.ts';
import { isOutputTooLarge } from './is-output-too-large.ts';
import { judgedError } from './judged-error.ts';
import { recordAttempt } from './record-attempt.ts';
import { sealedOutputOf } from './sealed-output-of.ts';
import { settleKeepingContinuation } from './settle-keeping-continuation.ts';

/**
 * The way out when the end unit of an attempt failed for a reason other than a lost lease (a
 * continuation the build no longer has, an input that no longer fits it, a store error): the
 * executor has run, so the effect must not stay `requested` with an open attempt. A fresh unit
 * judges the attempt as the end unit does (`endEffectAttempt`): the output is sealed first, and
 * one over 64 KiB is `core.effect_output_too_large`, which the destination did not act on; any
 * other failure to take the answer, and an executor that returned after the destination acted, is
 * `core.effect_outcome_unknown`. The end record is always appended, with the projection that
 * matches the settlement, even when the effect was settled meanwhile. The effect settles
 * `succeeded` with the sealed output, else `abandoned` when the destination may have acted, else
 * `failed` with the executor's own failure. A failure that the executor did not act on, a timeout
 * included, and that the retry policy allows again is not settled: the job completes `retry`, so
 * one store error never turns a retryable failure into a permanent one. The continuation is
 * kept: it is dropped only when it is gone or no longer fits (`settleKeepingContinuation`). When
 * the fresh unit fails too the job is completed `retry`, and its next taker settles the effect
 * `abandoned` from the open attempt. A lost lease anywhere in here is rethrown: the attempt then
 * changes nothing.
 */
export async function settleAfterFailedEnd(
  context: RunJobContext,
  target: EffectAttemptJob,
  began: Extract<BeganAttempt, { readonly kind: 'run' }>,
  result: AttemptResult,
  cause: unknown,
): Promise<void> {
  if (isLeaseLost(cause)) throw cause;
  const { stored, registry, effectId, entry, requestId } = target;
  const { source, worker, writer, clock, random } = context;
  const declared = declaredErrorCodesOf(registry, entry?.module);
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  const now = clock.now();
  try {
    await source.handle.adapter.unit(source.namespace, stored.scope, async (unit) => {
      if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
      const row = await unit.rows.findOne(descriptor, {
        where: { op: 'eq', field: 'id', value: effectId },
      });
      const held = { attempt: stored.attempt, worker };
      const record = (error?: EffectAttemptError): Promise<void> =>
        recordAttempt(unit, registry, effectId, {
          process: worker,
          build: writer.build.id,
          attempt: stored.attempt.attempt,
          startedAt: began.startedAt,
          endedAt: now.toString(),
          ...(error === undefined ? {} : { error }),
        });
      let failure: unknown = result.ok ? undefined : result.error;
      let acted = !result.ok && result.acted === true;
      let sealed: Readonly<Record<string, unknown>> | undefined;
      if (result.ok) {
        try {
          if (entry === undefined) throw errors.internal('the app has no entry for the effect');
          sealed = await sealedOutputOf(unit, entry, effectId, result.output);
        } catch (error) {
          if (isLeaseLost(error)) throw error;
          // Too large is the sheet's own failure; any other error took the answer after the destination acted.
          failure = error;
          acted = !isOutputTooLarge(error);
        }
      }
      if (sealed !== undefined) {
        await record();
        if (row === undefined || row.status !== 'requested') {
          await completeJob(unit, held, { kind: 'succeeded' });
          return;
        }
        const output = sealed;
        await settleKeepingContinuation(
          unit,
          { registry, entry, row, cause: stored, writer, clock },
          () => Promise.resolve({ status: 'succeeded', output }),
          began.started,
        );
        await completeJob(unit, held, { kind: 'succeeded' });
        return;
      }
      const projection = attemptErrorOf(failure, requestId, declared);
      const outcome = jobOutcomeOfError(judgedError(failure, projection), stored, now, random);
      if (outcome === undefined) throw jobLeaseLost();
      const error = acted
        ? attemptErrorOf(coreError('core.effect_outcome_unknown'), requestId, declared)
        : projection;
      await record(error);
      if (row === undefined || row.status !== 'requested') {
        await completeJob(unit, held, { kind: 'succeeded' });
        return;
      }
      if (!acted && outcome.kind === 'retry') {
        await completeJob(unit, held, {
          kind: 'retry',
          at: outcome.at,
          error: effectJobError(error),
        });
        return;
      }
      // The continuation is known and still valid unless the nested settle says otherwise.
      const settled = await settleKeepingContinuation(
        unit,
        { registry, entry, row, cause: stored, writer, clock },
        () => Promise.resolve({ status: acted ? 'abandoned' : 'failed', error }),
        began.started,
      );
      await completeJob(
        unit,
        held,
        settled?.status === 'failed' || settled?.status === 'abandoned'
          ? { kind: 'failed', error: effectJobError(error) }
          : { kind: 'succeeded' },
      );
    });
  } catch (error) {
    if (isLeaseLost(error)) throw error;
    // Nothing was written. The attempt stays open, and the next taker settles it `abandoned`.
    const wait = retryDelay(stored.retry, stored.attempt.attempt, random);
    await settleJobAttempt(context, stored, {
      kind: 'retry',
      at: now.add({ milliseconds: wait ?? 1000 }),
      error: effectJobError(attemptErrorOf(error, requestId, declared)),
    });
  }
}
