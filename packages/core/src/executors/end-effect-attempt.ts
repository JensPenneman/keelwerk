import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { errors } from '../errors/errors.ts';
import { coreError } from '../http/core-error.ts';
import { completeJob } from '../worker/complete-job.ts';
import { jobLeaseLost } from '../worker/job-lease-lost.ts';
import { jobOutcomeOfError } from '../worker/job-outcome-of-error.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { attemptErrorOf } from './attempt-error-of.ts';
import type { BeganAttempt } from './begin-effect-attempt.ts';
import { declaredErrorCodesOf } from './declared-error-codes-of.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import { effectJobError } from './effect-job-error.ts';
import { isOutputTooLarge } from './is-output-too-large.ts';
import { judgedError } from './judged-error.ts';
import { recordAttempt } from './record-attempt.ts';
import { sealedOutputOf } from './sealed-output-of.ts';
import { settleEffect } from './settle-effect.ts';

/** What the executor answered. */
export type AttemptResult =
  | { readonly ok: true; readonly output: Readonly<Record<string, unknown>> }
  | {
      readonly ok: false;
      readonly error: unknown;
      /** The executor returned, so the destination acted, and the kernel then failed to take the answer: the effect settles `abandoned`, never `failed`. */
      readonly acted?: true;
    };

/**
 * The last unit of an attempt (D2, D1): in one unit of the job's scope, the output is sealed under
 * the effect's binding and measured (over 64 KiB is `core.effect_output_too_large`, rolled back so
 * no value key stays behind), the end record is appended, and the attempt ends by the error
 * taxonomy: a retryable failure that the policy allows appends the record and completes the job
 * `retry`; anything else settles the effect (`settleEffect`, with the attempts that started) and
 * completes the job. A failure of the kernel after the executor returned (an answer that does not
 * fit the output shape, a sealing that fails) settles `abandoned`: the destination acted. An effect that was settled meanwhile only gets its end record. Every
 * completion goes through `completeJob`, so a worker that lost its lease changes nothing. Only the
 * closed projection of a failure is stored, never the executor's text.
 */
export function endEffectAttempt(
  context: RunJobContext,
  target: EffectAttemptJob,
  began: Extract<BeganAttempt, { readonly kind: 'run' }>,
  result: AttemptResult,
): Promise<EffectAttemptError | undefined> {
  const { stored, registry, effectId, entry, requestId } = target;
  const { source, worker, writer, clock, random } = context;
  const declared = declaredErrorCodesOf(registry, entry?.module);
  const held = { attempt: stored.attempt, worker };
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  return source.handle.adapter.unit(source.namespace, stored.scope, async (unit) => {
    if (descriptor === undefined || entry === undefined) {
      throw errors.internal('the app has no core.effect entity');
    }
    const row = await unit.rows.findOne(descriptor, {
      where: { op: 'eq', field: 'id', value: effectId },
    });
    const now = clock.now();
    const record = (error?: EffectAttemptError): Promise<void> =>
      recordAttempt(unit, registry, effectId, {
        process: worker,
        build: writer.build.id,
        attempt: stored.attempt.attempt,
        startedAt: began.startedAt,
        endedAt: now.toString(),
        ...(error === undefined ? {} : { error }),
      });
    const settleTarget = (settled: Parameters<typeof settleEffect>[2]): Promise<boolean> =>
      row === undefined
        ? Promise.resolve(false)
        : settleEffect(
            unit,
            { registry, entry, row, cause: stored, writer, clock },
            settled,
            began.started,
          );

    let failure: unknown = result.ok ? undefined : result.error;
    let acted = !result.ok && result.acted === true;
    let sealed: Readonly<Record<string, unknown>> | undefined;
    if (result.ok) {
      try {
        sealed = await sealedOutputOf(unit, entry, effectId, result.output);
      } catch (error) {
        // Too large is the sheet's own failure; any other kernel error took the answer after the destination acted.
        failure = error;
        acted = !isOutputTooLarge(error);
      }
    }
    if (sealed !== undefined) {
      await record();
      await settleTarget({ status: 'succeeded', output: sealed });
      await completeJob(unit, held, { kind: 'succeeded' });
      return undefined;
    }
    const projection = attemptErrorOf(failure, requestId, declared);
    const outcome = jobOutcomeOfError(judgedError(failure, projection), stored, now, random);
    if (outcome === undefined) throw jobLeaseLost();
    if (acted) {
      const unknown = attemptErrorOf(coreError('core.effect_outcome_unknown'), requestId, declared);
      await record(unknown);
      const abandoned = await settleTarget({ status: 'abandoned', error: unknown });
      await completeJob(
        unit,
        held,
        abandoned ? { kind: 'failed', error: effectJobError(unknown) } : { kind: 'succeeded' },
      );
      return unknown;
    }
    await record(projection);
    if (outcome.kind === 'retry') {
      await completeJob(unit, held, {
        kind: 'retry',
        at: outcome.at,
        error: effectJobError(projection),
      });
      return projection;
    }
    const settled = await settleTarget({ status: 'failed', error: projection });
    await completeJob(
      unit,
      held,
      settled ? { kind: 'failed', error: effectJobError(projection) } : { kind: 'succeeded' },
    );
    return projection;
  });
}
