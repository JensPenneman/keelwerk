import { hybridClock } from '../clock/hybrid-clock.ts';
import { plannedEffectIds } from '../effects/planned-effect-ids.ts';
import { runKernelEffects } from '../effects/run-kernel-effects.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { buildDecisionRecord } from '../events/build-decision-record.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { RecordedAnswer } from '../events/recorded-answer.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { sealDecisionInput } from '../events/seal-decision-input.ts';
import { generatedEntity } from '../generated-actions/generated-entity.ts';
import { generatedHandlerOf } from '../generated-actions/generated-handler-of.ts';
import { generatedSet } from '../generated-actions/generated-set.ts';
import { setResultWithState } from '../generated-actions/set-result-with-state.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import type { Clock } from '../kernel/clock.ts';
import { sealedValueText } from '../keys/sealed-value-text.ts';
import { appendReactionProcessEvents } from '../reactions/append-reaction-process-events.ts';
import { processDraftsOf } from '../reactions/process-drafts-of.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { stateTokenKey } from '../tokens/state-token-key.ts';
import { completeJobHere } from '../worker/complete-job-here.ts';
import { appendEvents } from './append-events.ts';
import { appendReceiptChange } from './append-receipt-change.ts';
import { appendStreamRecords } from './append-stream-records.ts';
import { checkWrittenItems } from './check-written-items.ts';
import { commandOutput } from './command-output.ts';
import { defaultNodeId } from './default-node-id.ts';
import { draftsToEvents } from './drafts-to-events.ts';
import { insertPendingReceipt } from './insert-pending-receipt.ts';
import { loadTarget } from './load-target.ts';
import { nestedFingerprint } from './nested-fingerprint.ts';
import { normalizeDecision } from './normalize-decision.ts';
import { openDecision } from './open-decision.ts';
import { openReactionJob } from './open-reaction-job.ts';
import { receiptRow } from './receipt-row.ts';
import { receiptWindowMs } from './receipt-window-ms.ts';
import { refuseGeneratedWrite } from './refuse-generated-write.ts';
import { replayReceipt } from './replay-receipt.ts';
import type { RunCommandInput } from './run-command-input.ts';
import { runInUnitKeys } from './run-in-unit-keys.ts';
import { sealCommandOutput } from './seal-command-output.ts';
import { sealDrafts } from './seal-drafts.ts';
import { writeStateRows } from './write-state-rows.ts';

/** What one attempt of a command runs with. */
export interface AttemptInput {
  readonly run: RunCommandInput;
  readonly commandId: string;
  readonly fingerprint: string;
  /** The invocation's clock: one instant for every attempt. */
  readonly clock: Clock;
  readonly prepared: unknown;
  /** An `invoke` runs the command nested: how deep, and the command that invoked it. */
  readonly nested?: { readonly depth: number; readonly causationId: string };
}

/**
 * Phases 3 to 7 of section 7.9.4 in one unit: the pending receipt, the target and its lock, the
 * decision driven with its requests answered, the drafts evolved, written and item-checked, the
 * kernel effects, and the completed receipt. Any failure throws and the unit rolls back, the
 * receipt with it.
 */
export async function attemptCommand(input: AttemptInput, unit: Unit): Promise<CommandResult> {
  const { commandId, fingerprint, clock } = input;
  const run = runInUnitKeys(input.run, unit);
  const { action, registry } = run;
  const authority = action.contributedBy ?? action.module;
  refuseGeneratedWrite(run);
  const now = clock.now();

  const job = input.nested === undefined ? run.job : undefined;
  // A nested command is caused by the command that invoked it; a continuation job by its effect.
  const causationId = input.nested?.causationId ?? job?.causationId;
  const receipt = receiptRow({
    commandId,
    action: action.ref,
    fingerprint,
    principal: run.principal,
    apiVersion: run.apiVersion,
    request: run.request,
    ...(run.client === undefined ? {} : { client: run.client }),
    now,
    windowMs: receiptWindowMs(action, job),
  });
  const pending = await insertPendingReceipt(unit, receipt, { takeOver: job !== undefined });
  if (pending.kind === 'inserted' && run.replayOnly === true) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.command_in_progress',
      message: 'The receipt of this command expired while it was replayed: send it again.',
      retryable: true,
    });
  }
  if (pending.kind === 'replay') {
    const replayed = await replayReceipt(unit, registry, action, authority, pending.receipt);
    if (job !== undefined) await completeJobHere(unit, job, action.scope, { kind: 'succeeded' });
    return replayed;
  }

  const targetReads: RecordedRead[] = [];
  const loaded = new Map<string, StorageRow>();
  const entry =
    action.instance && action.entity !== undefined
      ? registry.entities.get(action.entity)
      : undefined;
  let target: StorageRow | undefined;
  if (action.instance) {
    if (entry === undefined) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `"${action.ref}" is an entity command without an entity.`,
      });
    }
    target = await loadTarget({
      unit,
      registry,
      rules: run.rules,
      action,
      entry,
      principal: run.principal,
      scope: run.scope,
      input: run.input,
      reads: targetReads,
      flags: run.flags,
    });
    loaded.set(`${entry.ref}/${String(target.id)}`, target);
  }

  // A job that runs a reaction reads the event it names before its decision opens (7.7); the
  // receipt above already answered a replay.
  const opened = await openReactionJob(unit, run, job);
  const decision = openDecision({
    run,
    unit,
    form: 'decide',
    clock,
    prepared: input.prepared,
    ...(entry === undefined || target === undefined ? {} : { target: { entry, row: target } }),
    ...(opened?.decisionProcess === undefined ? {} : { process: opened.decisionProcess }),
  });
  let handled: unknown;
  const generated = action.generated === undefined ? undefined : generatedEntity(registry, action);
  if (opened !== undefined) {
    handled = opened.decide(decision.ctx);
  } else if (action.generated === 'set' && generated !== undefined) {
    handled = await generatedSet({ run, unit, entry: generated, decision });
  } else {
    const handler =
      generated === undefined ? action.handler : generatedHandlerOf(action, generated);
    if (entry !== undefined && target !== undefined) {
      const { id: _id, ifVersion: _ifVersion, ...rest } = run.input as Record<string, unknown>;
      handled = handler(rest, decodeRow(entry, target, authority), decision.ctx);
    } else {
      handled = handler(run.input, decision.ctx);
    }
  }
  const decided = normalizeDecision(await decision.drive(handled));
  run.signal?.throwIfAborted();

  const reads = [...targetReads, ...decision.reads];
  const flags = [...decision.flags.values()];
  const plannedEffects = plannedEffectIds(run.scope, commandId, decided.effects);
  const processClock = run.hybridClock ?? hybridClock(run.nodeId ?? defaultNodeId);
  let meta: EventMeta | undefined;
  const sealedVerifiers = new Map<string, string>();
  // The events a process's decision holds for its own stream are not entity drafts: they follow
  // the entity events, sealed under the instance and chained by `appendProcessEvents`.
  const split = processDraftsOf(opened, decided.drafts);
  const drafts = await sealDrafts({ registry, unit, drafts: split.entities, sealedVerifiers });
  // The record keeps an issued verifier sealed, never plain: the row's own sealed text, or a value
  // of its own under the decision when no row took it (7.9.3, 14.7.4).
  const answers: RecordedAnswer[] = [];
  for (const answer of decision.answers) {
    if (answer.kind !== 'secret') {
      answers.push(answer);
      continue;
    }
    const text =
      sealedVerifiers.get(answer.verifier) ??
      sealedValueText(
        await unit.keys.sealValue(
          { entity: 'core.decision', id: commandId, field: `verifier.${answer.publicId}` },
          new TextEncoder().encode(answer.verifier),
        ),
      );
    answers.push({ ...answer, verifier: text });
  }
  const sealedInput =
    action.trace?.input === 'sealed'
      ? await sealDecisionInput(unit, commandId, action.input, run.input)
      : undefined;
  const written = await draftsToEvents({
    unit,
    registry,
    behaviours: run.behaviours,
    drafts,
    authority,
    now,
    meta: (recorded) => {
      meta = buildEventMeta({
        principal: run.principal,
        commandId,
        action: action.ref,
        correlationId: run.correlationId ?? run.request.requestId,
        ...(causationId === undefined ? {} : { causationId }),
        ...(run.client === undefined ? {} : { client: run.client }),
        ...(run.traceparent === undefined ? {} : { traceparent: run.traceparent }),
        build: run.build,
        flags,
        decision: buildDecisionRecord({
          part: action.ref,
          inputDigest: fingerprint,
          reads: recorded,
          answers,
          ...(sealedInput === undefined ? {} : { input: sealedInput }),
          effects: plannedEffects,
        }),
      });
      return meta;
    },
    reads,
    loaded,
    hybridClock: processClock,
  });
  if (meta === undefined) throw errors.internal('the decision wrote without building its meta');
  await writeStateRows(unit, written);
  await appendEvents(unit, written);
  await appendReactionProcessEvents({
    unit,
    opened,
    drafts: split.events,
    meta,
    hybridClock: processClock,
    now,
  });
  await appendStreamRecords({ registry, unit, authority, appends: decided.appends });
  await checkWrittenItems({
    unit,
    registry,
    rules: run.rules,
    action,
    principal: run.principal,
    scope: run.scope,
    written,
    flags: run.flags,
  });

  const effects = await runKernelEffects({
    unit,
    run,
    commandId,
    clock,
    meta,
    written,
    effects: decided.effects,
    hybridClock: processClock,
    depth: input.nested?.depth ?? 0,
    ...(opened?.event === undefined
      ? {}
      : { cause: { eventId: opened.event.id, actor: opened.event.actor } }),
    runNested: async (nestedUnit, nestedRun, nested) =>
      attemptCommand(
        {
          run: nestedRun,
          commandId: nested.commandId,
          fingerprint: await nestedFingerprint(nestedRun),
          clock,
          prepared: undefined,
          nested,
        },
        nestedUnit,
      ),
  });
  const result =
    action.generated === 'set' && generated !== undefined
      ? setResultWithState(
          run,
          unit,
          generated,
          decided.result,
          await stateTokenKey(run.keys, run.scope),
        )
      : decided.result;
  const { output, outcome } = commandOutput({
    registry,
    action,
    authority,
    written,
    target,
    result,
    effects,
  });
  run.signal?.throwIfAborted();
  const sealedOutcome = await sealCommandOutput(unit, commandId, action, outcome);
  await unit.receipts.complete(commandId, sealedOutcome);
  if (job !== undefined) {
    if (pending.kind === 'taken') {
      await appendReceiptChange(unit, {
        registry,
        scope: run.scope,
        receipt: { ...receipt, status: 'completed', outcome: sealedOutcome },
        meta: buildEventMeta({
          principal: run.principal,
          commandId,
          action: action.ref,
          correlationId: run.correlationId ?? run.request.requestId,
          build: run.build,
          flags: [],
          decision: null,
        }),
        hybridClock: processClock,
        now,
      });
    }
    await completeJobHere(unit, job, action.scope, { kind: 'succeeded' });
  }
  return { output, ...(effects.length > 0 ? { effects } : {}) };
}
