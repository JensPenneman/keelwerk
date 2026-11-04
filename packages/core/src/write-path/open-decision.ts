import type { FlagRead } from '../events/flag-read.ts';
import type { RecordedAnswer } from '../events/recorded-answer.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { ScopeRunner } from '../interpreter/answer-deps.ts';
import { buildReadContext } from '../interpreter/build-read-context.ts';
import { createRequestAnswerer } from '../interpreter/create-request-answerer.ts';
import { dispatchRequest } from '../interpreter/dispatch-request.ts';
import { driveHandler } from '../interpreter/drive-handler.ts';
import type { RequestAuthorities } from '../interpreter/request-authorities.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { Clock } from '../kernel/clock.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { buildDecideContext } from './build-decide-context.ts';
import { refuseEffectInUnit } from './refuse-effect-in-unit.ts';
import type { RunCommandInput } from './run-command-input.ts';

/** What one decision is opened with. */
export interface OpenDecisionInput {
  readonly run: RunCommandInput;
  readonly unit: Unit;
  readonly form: 'decide' | 'prepare';
  /** The invocation's clock: one instant for the whole command. */
  readonly clock: Clock;
  readonly prepared?: unknown;
  readonly target?: {
    readonly entry: EntityEntry;
    readonly row: Readonly<Record<string, unknown>>;
  };
}

/** A decision being driven in a unit: its context, and what the interpreter recorded while answering. */
export interface OpenedDecision {
  readonly ctx: Readonly<Record<string, unknown>>;
  readonly reads: RecordedRead[];
  readonly answers: RecordedAnswer[];
  readonly flags: Map<string, FlagRead>;
  /** Drives what the handler returned, answering each request in the unit. */
  drive(result: unknown): Promise<unknown>;
}

/**
 * Opens the interpreter for one decision (phases 2 and 5 of section 7.9.4): the contexts, the
 * answerers of `runRead`, and the decision record's reads, answers and flags. `prepare` and
 * `decide` share it; only the form differs, and a `prepare` unit is read-only (S-05).
 */
export function openDecision(input: OpenDecisionInput): OpenedDecision {
  const { run, unit } = input;
  const { registry, adapter, action } = run;
  const { rules } = run;
  const authority = action.contributedBy ?? action.module;
  const reads: RecordedRead[] = [];
  const answers: RecordedAnswer[] = [];
  const flags = new Map<string, FlagRead>();
  const authorities: RequestAuthorities = new WeakMap();
  const contexts = buildReadContext({
    registry,
    authorities,
    rules,
    principal: run.principal,
    scope: run.scope,
    clock: input.clock,
    request: run.request,
    config: run.config ?? (() => undefined),
    log: run.log,
    trace: run.trace,
  });
  const inScope: ScopeRunner =
    run.concurrentUnits === true
      ? (_from, scope, fn) =>
          adapter.unit(run.namespaceOf?.(scope) ?? run.namespace, scope, fn, { readOnly: true })
      : (from, scope, fn) => from.nested(fn, { as: scope, readOnly: true });
  const answerer = createRequestAnswerer({
    rules,
    action,
    inScope,
    contexts,
    authorities,
    replace: {
      ...run.replace,
      ...(input.form === 'decide' ? { perform: refuseEffectInUnit } : {}),
    },
  });
  const context: AnswerContext = {
    registry,
    unit,
    scope: run.scope,
    principal: run.principal,
    module: authority,
    form: input.form,
    clock: input.clock,
    keys: run.keys,
    compute: run.compute,
    log: run.log,
    flags,
    answer: (request) => dispatchRequest(answerer, request, context),
    record: {
      read: (read) => {
        reads.push(read);
      },
      answer: (answer) => {
        answers.push(answer);
      },
      flag: (read) => {
        flags.set(read.key, read);
      },
    },
  };
  const ctx = buildDecideContext({
    base: contexts.forModule(authority),
    registry,
    authorities,
    module: authority,
    prepared: input.prepared,
    ...(input.target === undefined ? {} : { target: input.target }),
    withPerform: input.form === 'prepare',
    newId: (entity) => {
      const value = newUuidV7();
      answers.push({ kind: 'id', entity, value });
      return value;
    },
  });
  return { ctx, reads, answers, flags, drive: (result) => driveHandler(result, context.answer) };
}
