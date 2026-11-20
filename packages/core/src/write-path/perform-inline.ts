import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import { beginInlineEffect } from './begin-inline-effect.ts';
import type { InlineAnswer } from './inline-answer.ts';
import type { RunCommandInput } from './run-command-input.ts';
import { runInlineExecutor } from './run-inline-executor.ts';
import { settleInlineEffect } from './settle-inline-effect.ts';

/** What one inline `perform` of `prepare` is run with. */
export interface PerformInlineInput {
  /** The prepare run: registry, adapter, namespace, scope, action, principal, keys, config, egress, log, trace, signal, build, hybridClock, nodeId. */
  readonly run: RunCommandInput;
  /** The live clock (attempt timings, settledAt, the guard's runAt); `run.clock` is the invocation's fixed instant. */
  readonly clock: Clock;
  readonly commandId: string;
  /** `inlineEffectId(run.scope, commandId, index)`. */
  readonly effectId: string;
  readonly effect: ExternalEffect;
  /** `CommandDigests.fingerprint`, compared with an unexpired receipt before a row is answered or a new inline effect starts. */
  readonly fingerprint: string;
  /** `CommandDigests.legacyFingerprint`: the 0.1.0 form, computed only when a 0.1.0 receipt is compared. */
  readonly legacyFingerprint: () => string;
}

/**
 * One `ctx.perform` (D1 to D6): the refusals before any unit, `beginInlineEffect` (the `requested`
 * record in a short unit), `runInlineExecutor` outside any unit, and `settleInlineEffect` (the
 * `settled` record in another). Answers the outcome as a value: an executor's failure is an answer,
 * not an error. Rejects only for a refusal, a store failure (the guard job then settles the
 * effect), `core.command_in_progress`, `core.idempotency_mismatch` (a row that is not this run's),
 * or the run's signal reason: before any unit opens when the signal is already aborted, and after
 * the effect settled when it aborted while the effect ran, so `prepare` never goes on under an
 * aborted signal. An abort during the begin unit rejects with the reason and stores nothing: the unit
 * is rolled back, so a retry with the same command id runs the effect.
 */
export async function performInline(input: PerformInlineInput): Promise<InlineAnswer> {
  const { run, effect } = input;
  const { registry } = run;
  const entry = registry.effects.get(effect.type);
  if (entry === undefined) {
    throw refuseRequest(`the effect "${effect.type}"`, 'no module of this app declares it');
  }
  if (entry.performer === 'external') {
    throw refuseRequest(`the effect "${entry.ref}"`, 'an outside performer performs it');
  }
  const executor = entry.executor === null ? undefined : registry.executors.get(entry.executor);
  if (executor === undefined) {
    throw refuseRequest(`the effect "${entry.ref}"`, 'it has no executor');
  }
  if (!executor.inline) {
    throw refuseRequest(`the effect "${entry.ref}"`, 'its executor is not inline');
  }
  for (const member of ['continueWith', 'with', 'key', 'runAt', 'deadline'] as const) {
    if (effect[member] !== undefined) {
      throw refuseRequest(
        `the effect "${entry.ref}"`,
        `an inline effect has no ${member}: its outcome is the answer`,
      );
    }
  }
  run.signal?.throwIfAborted();
  const began = await beginInlineEffect(input, entry, executor);
  if (began.kind === 'answered') return began.answer;
  const result = await runInlineExecutor(input, entry, executor, began.input);
  const answer = await settleInlineEffect(input, entry, executor, began, result);
  if (run.signal?.aborted === true) throw run.signal.reason;
  return answer;
}
