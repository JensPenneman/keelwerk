import { inlineEffectId } from '../effects/inline-effect-id.ts';
import type { PrepareRecord } from '../events/prepare-record.ts';
import type { Clock } from '../kernel/clock.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import { closedUnit } from './closed-unit.ts';
import { openDecision } from './open-decision.ts';
import { performInline } from './perform-inline.ts';
import type { PreparedRun } from './prepared-run.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * Phase 2 of section 7.9.4: undefined without `prepare`. Each top-level request is answered in a
 * read-only unit of its own (`openDecision` with `openUnit`, `unit: closedUnit`); a `perform` is
 * answered outside any unit: `run.replace.perform` when set (dry run), else `performInline`. Every
 * perform takes the next `inlineEffectId` first. What `prepare` read, was answered and performed is
 * the decision record's `prepare` member; nothing derived from a value `prepare` returned is kept.
 * The retries of the command do not repeat it. `at` carries the command's receipt fingerprint, which
 * `performInline` compares with an unexpired receipt before it answers a row or starts an effect.
 */
export async function runPrepare(
  run: RunCommandInput,
  input: unknown,
  at: {
    readonly commandId: string;
    readonly clock: Clock;
    readonly fingerprint: string;
    readonly legacyFingerprint: () => string;
  },
): Promise<PreparedRun | undefined> {
  const { action } = run;
  const { prepare } = action;
  if (prepare === undefined) return undefined;
  const now = run.clock.now();
  const effects: string[] = [];
  const replaced = run.replace?.perform;
  const perform: RequestAnswerer['perform'] = (request, context) => {
    const effectId = inlineEffectId(run.scope, at.commandId, effects.length);
    effects.push(effectId);
    if (replaced !== undefined) return replaced(request, context);
    return performInline({
      run,
      clock: at.clock,
      commandId: at.commandId,
      effectId,
      effect: request.effect,
      fingerprint: at.fingerprint,
      legacyFingerprint: at.legacyFingerprint,
    });
  };
  const decision = openDecision({
    run: { ...run, replace: { ...run.replace, perform } },
    unit: closedUnit,
    form: 'prepare',
    clock: { now: () => now },
    openUnit: (fn) =>
      run.adapter.unit(run.namespace, run.scope, fn, {
        readOnly: true,
        ...(run.signal === undefined ? {} : { signal: run.signal }),
      }),
  });
  const value = await decision.drive(prepare(input, decision.ctx));
  const record: PrepareRecord = {
    reads: decision.reads,
    answers: decision.answers,
    effects,
  };
  return { value, record, flags: [...decision.flags.values()] };
}
