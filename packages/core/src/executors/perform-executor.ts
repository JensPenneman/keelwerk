import { errors } from '../errors/errors.ts';
import type { Job } from '../jobs/job.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { abortRace } from './abort-race.ts';
import { attemptEnded } from './attempt-ended.ts';
import { attemptErrorOf } from './attempt-error-of.ts';
import { declaredErrorCodesOf } from './declared-error-codes-of.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import type { EffectConfig } from './effect-config.ts';
import type { AttemptResult } from './end-effect-attempt.ts';
import { executorContextOf } from './executor-context-of.ts';
import { executorEgress } from './executor-egress.ts';
import { executorSecrets } from './executor-secrets.ts';

/**
 * Runs the executor of one attempt outside any unit (7.9.5): with the context of `executorContextOf`
 * (the scope, the effect id as idempotency key, the configuration, `secrets.reveal`, `egress.fetch`
 * under this process's policy, the log, the span and the signal) and the opened input. The signal
 * is the job's (it aborts at `expireInSeconds`, at a lost lease and at a worker's stop) and also
 * aborts when the attempt ends, so a fetch or a reveal that a late executor makes afterwards is
 * refused and sends and opens nothing. The executor is not called when the job's signal is already
 * aborted (the failure then says `unrun`). The run is raced against the job's signal, so an
 * executor that ignores `expireInSeconds` still ends the attempt; its late rejection is caught and
 * logged once with its code only. The answer is checked against the effect's output shape: an
 * answer that does not match is a failure after the destination acted (`acted`). A rejection is the
 * signal's reason when the signal aborted. Never throws: the failure is returned and judged by the
 * caller.
 */
export async function performExecutor(
  job: Job,
  context: RunJobContext,
  target: EffectAttemptJob,
  run: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly config: EffectConfig;
    readonly span: Span;
    readonly log: Logger;
  },
): Promise<AttemptResult> {
  const { executor, entry, effectId, stored } = target;
  if (executor === undefined || entry === undefined) {
    return { ok: false, error: errors.internal('No executor performs this effect.') };
  }
  if (job.signal.aborted) return { ok: false, error: job.signal.reason, unrun: true };
  const { source } = context;
  const abort = abortRace(job.signal);
  const ended = new AbortController();
  const signal = AbortSignal.any([job.signal, ended.signal]);
  let answer: unknown;
  try {
    const executorContext = executorContextOf({
      scope: stored.scope,
      effect: { id: effectId, type: entry.ref, attempt: stored.attempt.attempt },
      config: run.config.value as never,
      secrets: executorSecrets({
        keys: context.keys,
        open: (fn) =>
          source.handle.adapter.unit(source.namespace, stored.scope, fn, { readOnly: true }),
        module: entry.module,
        scope: stored.scope,
        schema: entry.input,
        input: run.input,
        config: run.config,
        effectId,
        log: run.log,
        signal,
      }),
      egress: executorEgress({
        policy: context.egress,
        effectId,
        log: run.log,
        trace: run.span,
        signal,
      }),
      log: run.log,
      trace: run.span,
      signal,
    });
    const running = executor.run(run.input, executorContext);
    // The race below leaves the executor's own promise behind when the abort wins: its late
    // rejection is caught here and logged once, the code only.
    running.catch((late: unknown) => {
      if (!job.signal.aborted && !ended.signal.aborted) return;
      run.log.warn('effect executor rejected after its attempt ended', {
        effect: effectId,
        code: attemptErrorOf(
          late,
          target.requestId,
          declaredErrorCodesOf(target.registry, entry.module),
        ).code,
      });
    });
    answer = await Promise.race([running, abort.promise]);
  } catch (error) {
    ended.abort(attemptEnded());
    abort.stop();
    return { ok: false, error: job.signal.aborted ? job.signal.reason : error };
  }
  // The executor returned: from here on a failure is the kernel's, after the destination acted.
  try {
    const checked = await entry.output['~standard'].validate(answer ?? {});
    if (checked.issues !== undefined) {
      return {
        ok: false,
        acted: true,
        error: errors.internal('The executor answered an output that does not match the effect.'),
      };
    }
    return { ok: true, output: checked.value as Readonly<Record<string, unknown>> };
  } catch (error) {
    return { ok: false, acted: true, error };
  } finally {
    ended.abort(attemptEnded());
    abort.stop();
  }
}
