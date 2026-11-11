import { SpanStatusCode } from '@opentelemetry/api';
import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Job } from '../jobs/job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { beginEffectAttempt } from './begin-effect-attempt.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import type { EffectConfig } from './effect-config.ts';
import { effectConfigOf } from './effect-config-of.ts';
import { endEffectAttempt } from './end-effect-attempt.ts';
import { performExecutor } from './perform-executor.ts';
import { settleAfterFailedEnd } from './settle-after-failed-end.ts';

/** Whether an aborted attempt ran out of `expireInSeconds`: a failure of the attempt like any other. */
function isTimeout(reason: unknown): boolean {
  return isKeelwerkError(reason) && reason.code === 'core.timeout';
}

/**
 * One attempt of an effect job (7.9.5, D1 to D3): a begin unit that decides whether the executor
 * may run (`beginEffectAttempt`), the executor outside any unit (`performExecutor`), and an end
 * unit that retries or settles (`endEffectAttempt`). The job row never holds the input: the
 * executor's input is opened in the begin unit and lives in memory for the attempt. Rejects only
 * with `core.job_lease_lost` (or the reason of a worker that is stopping, which the lease's expiry
 * resolves: the destination may have acted, so the next taker settles the effect `abandoned`) or a
 * kernel `internal`; the executor's own text never reaches the fetcher's fallback. A failure of the
 * end unit does not end the job with the effect `requested` and an open attempt: `settleAfterFailedEnd`.
 */
export async function runEffectJob(job: Job, context: RunJobContext): Promise<void> {
  const { stored } = job;
  if (!('executor' in stored.run)) return;
  const { executor: executorRef, effect: effectId } = stored.run;
  const { registry } = context.source;
  const executor = registry.executors.get(executorRef);
  const entry = executor === undefined ? undefined : registry.effects.get(executor.effect);
  const target: EffectAttemptJob = {
    stored,
    registry,
    effectId,
    scope: stored.scope,
    executor,
    entry,
    requestId: newUuidV7(),
  };
  const log = context.log.child({
    effect: effectId,
    executor: executorRef,
    attempt: stored.attempt.attempt,
    requestId: target.requestId,
  });
  let config: EffectConfig = { value: {}, shape: undefined };
  let configError: unknown;
  if (entry !== undefined) {
    try {
      config = await effectConfigOf(context, stored.scope, entry.module);
    } catch (error) {
      configError = error;
    }
  }
  const began = await beginEffectAttempt(
    context,
    target,
    configError === undefined ? {} : { error: configError },
  );
  if (began.kind === 'finished') return;
  const span = context.tracer.startSpan('keelwerk.effect', {
    attributes: {
      'keelwerk.effect.id': effectId,
      'keelwerk.effect.type': entry?.ref ?? executorRef,
      'keelwerk.effect.attempt': stored.attempt.attempt,
      'keelwerk.request.id': target.requestId,
    },
  });
  try {
    const result = await performExecutor(job, context, target, {
      input: began.input,
      config,
      span,
      log,
    });
    if (!result.ok && job.signal.aborted && !isTimeout(job.signal.reason)) {
      throw job.signal.reason;
    }
    let failure: EffectAttemptError | undefined;
    try {
      failure = await endEffectAttempt(context, target, began, result);
    } catch (cause) {
      // The executor has run. Whatever broke the end unit, but a lost lease, the effect is settled
      // in a fresh unit or, failing that, the job is retried so its next taker settles it.
      log.warn('the end of the attempt failed', {
        code: isKeelwerkError(cause) ? cause.code : 'core.internal',
      });
      await settleAfterFailedEnd(context, target, began, result, cause);
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    if (failure !== undefined) {
      log.warn('effect attempt failed', { code: failure.code });
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  } finally {
    span.end();
  }
}
