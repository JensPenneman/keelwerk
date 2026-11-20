import { inlineEffectId } from '../effects/inline-effect-id.ts';
import { errors } from '../errors/errors.ts';
import type { DecisionRequest } from '../events/decision-request.ts';
import type { FlagRead } from '../events/flag-read.ts';
import type { PrepareRecord } from '../events/prepare-record.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { Unit } from '../storage/unit.ts';
import { closedUnit } from '../write-path/closed-unit.ts';
import { openDecision } from '../write-path/open-decision.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { asOfAdapter } from './as-of-adapter.ts';
import type { AsOfContext } from './as-of-context.ts';
import { createAsOfReads } from './as-of-reads.ts';
import { asOfUnit } from './as-of-unit.ts';
import { replayAnswerers } from './replay-answerers.ts';
import { replayedPerform } from './replayed-perform.ts';

export interface ReplayPrepareInput {
  /** The re-decide's run (registry, scope, action, fingerprintKey, clock fixed at the recorded instant); its adapter is the real one. */
  readonly run: RunCommandInput;
  /** The real unit. */
  readonly unit: Unit;
  readonly context: Omit<AsOfContext, 'reads'>;
  readonly record: PrepareRecord;
  readonly commandId: string;
  readonly input: unknown;
  /** Personal members of an effect's input are compared by presence (`RedecideInput.personalByPresence`). */
  readonly personalByPresence?: true;
}

export interface ReplayedPrepare {
  readonly value: unknown;
  /** As re-decided: reads, answers, effect ids. */
  readonly record: PrepareRecord;
  readonly flags: readonly FlagRead[];
  readonly request: DecisionRequest | undefined;
}

/**
 * Runs `action.prepare` in one as-of view of the recorded decision: its loads answer from
 * `record.reads`, its ids and random values from `record.answers`, its performs from the settled
 * inline effect rows (never run again). No unit is opened per request and nothing is written.
 * Throws what the handler throws, and the replay refusals.
 */
export async function replayPrepare(input: ReplayPrepareInput): Promise<ReplayedPrepare> {
  const { run, unit, record, commandId } = input;
  const { action, scope } = run;
  const { prepare } = action;
  if (prepare === undefined) throw errors.internal(`"${action.ref}" has no prepare`);
  const context: AsOfContext = {
    ...input.context,
    reads: createAsOfReads(record.reads, scope.level),
  };
  const view = asOfUnit(unit, context);
  const now = run.clock.now();
  const effects: string[] = [];
  const performed = replayedPerform({
    unit,
    registry: run.registry,
    scope,
    commandId,
    recorded: record.effects,
    ...(input.personalByPresence === true ? { personalByPresence: true } : {}),
  });
  const perform: RequestAnswerer['perform'] = (request, answering) => {
    effects.push(inlineEffectId(scope, commandId, effects.length));
    return performed(request, answering);
  };
  const decision = openDecision({
    run: {
      ...run,
      adapter: asOfAdapter(run.adapter, context),
      replace: { ...replayAnswerers(record.answers), perform },
    },
    unit: closedUnit,
    form: 'prepare',
    clock: { now: () => now },
    openUnit: (fn) => fn(view),
  });
  const value = await decision.drive(prepare(input.input, decision.ctx));
  const read = decision.request();
  return {
    value,
    record: {
      reads: decision.reads,
      answers: decision.answers,
      effects,
    },
    flags: [...decision.flags.values()],
    request: read,
  };
}
