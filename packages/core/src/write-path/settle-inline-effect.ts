import { hybridClock } from '../clock/hybrid-clock.ts';
import { requestIdPattern } from '../effects/request-id-pattern.ts';
import { errors } from '../errors/errors.ts';
import { attemptErrorOf } from '../executors/attempt-error-of.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import { effectJobError } from '../executors/effect-job-error.ts';
import type { AttemptResult } from '../executors/end-effect-attempt.ts';
import { isOutputTooLarge } from '../executors/is-output-too-large.ts';
import { recordAttempt } from '../executors/record-attempt.ts';
import { sealedOutputOf } from '../executors/sealed-output-of.ts';
import { settleEffect } from '../executors/settle-effect.ts';
import { coreError } from '../http/core-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';
import { defaultNodeId } from './default-node-id.ts';
import type { InlineAnswer } from './inline-answer.ts';
import { inlineAnswerOf } from './inline-answer-of.ts';
import type { PerformInlineInput } from './perform-inline.ts';

/**
 * The last unit of an inline effect (D4, D5): in one read-write unit of the scope the output is
 * sealed and measured (over 64 KiB is `core.effect_output_too_large`), the end record of attempt 1
 * is appended, the effect settles (`succeeded`, `failed`, or `abandoned` when the destination acted
 * and the kernel could not take the answer) with one attempt and no continuation, and the guard job
 * is cancelled. The answer is what the unit wrote, or, when the effect was settled meanwhile (the
 * guard job), the row as it stands. Only the closed projection of a failure is stored.
 */
export function settleInlineEffect(
  input: PerformInlineInput,
  entry: EffectEntry,
  executor: ExecutorEntry,
  began: { readonly startedAt: string },
  result: AttemptResult,
): Promise<InlineAnswer> {
  const { run, effectId, commandId } = input;
  const { registry } = run;
  const declared = declaredErrorCodesOf(registry, entry.module);
  // The stored projection names a request id that is a UUID; a run under another id gets one of its own.
  const requestId = requestIdPattern.test(run.request.requestId)
    ? run.request.requestId
    : newUuidV7();
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  const processClock = run.hybridClock ?? hybridClock(run.nodeId ?? defaultNodeId);
  return run.adapter.unit(run.namespace, run.scope, async (unit): Promise<InlineAnswer> => {
    if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
    const row = await unit.rows.findOne(descriptor, {
      where: { op: 'eq', field: 'id', value: effectId },
    });
    if (row === undefined) throw errors.internal('the inline effect has no record to settle');
    const now = input.clock.now();
    const record = (error?: ReturnType<typeof attemptErrorOf>): Promise<void> =>
      recordAttempt(unit, registry, effectId, {
        process: run.nodeId ?? defaultNodeId,
        build: run.build.id,
        attempt: 1,
        startedAt: began.startedAt,
        endedAt: now.toString(),
        ...(error === undefined ? {} : { error }),
      });
    const settle = async (settled: Parameters<typeof settleEffect>[2]): Promise<InlineAnswer> => {
      const wrote = await settleEffect(
        unit,
        {
          registry,
          entry,
          row,
          continuation: 'skip',
          cause: {
            scope: run.scope,
            causation: {
              commandId,
              ...(run.job?.lineage === undefined ? {} : { lineage: run.job.lineage }),
            },
            build: run.build,
          },
          writer: { hybridClock: processClock, build: run.build },
          clock: input.clock,
        },
        settled,
        1,
      );
      await unit.jobs.cancel(executor.queue, effectId);
      if (!wrote) {
        const current = await unit.rows.findOne(descriptor, {
          where: { op: 'eq', field: 'id', value: effectId },
        });
        if (current === undefined) throw errors.internal('the inline effect has no record');
        return inlineAnswerOf(current);
      }
      return settled.status === 'succeeded'
        ? { ok: true, value: settled.output }
        : { ok: false, error: effectJobError(settled.error) };
    };

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
      return settle({ status: 'succeeded', output: sealed });
    }
    if (acted) {
      const unknown = attemptErrorOf(coreError('core.effect_outcome_unknown'), requestId, declared);
      await record(unknown);
      return settle({ status: 'abandoned', error: unknown });
    }
    const projection = attemptErrorOf(failure, requestId, declared);
    await record(projection);
    return settle({ status: 'failed', error: projection });
  });
}
