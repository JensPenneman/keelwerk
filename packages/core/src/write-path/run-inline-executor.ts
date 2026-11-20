import type { ExecutorContext } from '../contexts/executor-context.ts';
import { errors } from '../errors/errors.ts';
import { abortRace } from '../executors/abort-race.ts';
import { attemptEnded } from '../executors/attempt-ended.ts';
import { attemptErrorOf } from '../executors/attempt-error-of.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import type { AttemptResult } from '../executors/end-effect-attempt.ts';
import { executorContextOf } from '../executors/executor-context-of.ts';
import { executorEgress } from '../executors/executor-egress.ts';
import { executorSecrets } from '../executors/executor-secrets.ts';
import { inlineTimeoutMs } from '../executors/inline-timeout-ms.ts';
import { coreError } from '../http/core-error.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';
import type { PerformInlineInput } from './perform-inline.ts';

/**
 * Runs the executor of one inline effect outside any unit (7.9.5), once: within its timeout (an
 * abort with `core.timeout`) and the run's signal, raced with `abortRace`, with the context of a
 * queued attempt (the scope, the effect id as idempotency key, the configuration, `secrets.reveal`,
 * `egress.fetch` under the process's policy, the log, the span and a signal that also aborts when the
 * attempt ends). The answer is checked against the effect's output shape: an answer that does not
 * match is a failure after the destination acted (`acted`), and so is the abort of the run's own
 * signal once the executor has started; an abort before it starts is a plain failure. Never throws:
 * the failure is returned and judged by the caller.
 */
export async function runInlineExecutor(
  input: PerformInlineInput,
  entry: EffectEntry,
  executor: ExecutorEntry,
  executorInput: Readonly<Record<string, unknown>>,
): Promise<AttemptResult> {
  const { run, effectId } = input;
  const timeout = new AbortController();
  const ended = new AbortController();
  const timer = setTimeout(() => {
    timeout.abort(
      coreError('core.timeout', { message: 'The inline effect exceeded its timeout.' }),
    );
  }, inlineTimeoutMs(executor));
  const limits = AbortSignal.any([
    timeout.signal,
    ...(run.signal === undefined ? [] : [run.signal]),
  ]);
  const signal = AbortSignal.any([limits, ended.signal]);
  const abort = abortRace(limits);
  const log = run.log.child({ effect: effectId, executor: executor.ref, attempt: 1 });
  const config = { value: run.config?.(entry.module) ?? {}, shape: undefined };
  let answer: unknown;
  let started = false;
  try {
    if (limits.aborted) throw limits.reason;
    const context: ExecutorContext<unknown> = executorContextOf({
      scope: run.scope,
      effect: { id: effectId, type: entry.ref, attempt: 1 },
      config: config.value as never,
      secrets: executorSecrets({
        keys: run.keys,
        open: (fn) => run.adapter.unit(run.namespace, run.scope, fn, { readOnly: true }),
        module: entry.module,
        scope: run.scope,
        schema: entry.input,
        input: executorInput,
        config,
        effectId,
        log,
        signal,
      }),
      egress: executorEgress({ policy: run.egress, effectId, log, trace: run.trace, signal }),
      log,
      trace: run.trace,
      signal,
    });
    started = true;
    const running = executor.run(executorInput, context);
    running.catch((late: unknown) => {
      if (!limits.aborted && !ended.signal.aborted) return;
      log.warn('inline effect executor rejected after its attempt ended', {
        effect: effectId,
        code: attemptErrorOf(
          late,
          run.request.requestId,
          declaredErrorCodesOf(run.registry, entry.module),
        ).code,
      });
    });
    answer = await Promise.race([running, abort.promise]);
  } catch (error) {
    ended.abort(attemptEnded());
    abort.stop();
    clearTimeout(timer);
    if (started && run.signal?.aborted === true) {
      // The command was aborted while the destination may have acted.
      return { ok: false, acted: true, error: run.signal.reason };
    }
    return { ok: false, error: limits.aborted ? limits.reason : error };
  }
  clearTimeout(timer);
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
