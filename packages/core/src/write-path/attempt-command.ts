import { hybridClock } from '../clock/hybrid-clock.ts';
import { plannedEffectIds } from '../effects/planned-effect-ids.ts';
import { runKernelEffects } from '../effects/run-kernel-effects.ts';
import { errors } from '../errors/errors.ts';
import { buildDecisionRecord } from '../events/build-decision-record.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { EventMeta } from '../events/event-meta.ts';
import { generatedEntity } from '../generated-actions/generated-entity.ts';
import { setResultWithState } from '../generated-actions/set-result-with-state.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import type { Clock } from '../kernel/clock.ts';
import { chargeStorage } from '../quotas/charge-storage.ts';
import { isExemptFromTail } from '../quotas/is-exempt-from-tail.ts';
import { isUnitExemptFromTail } from '../quotas/is-unit-exempt-from-tail.ts';
import { appendReactionProcessEvents } from '../reactions/append-reaction-process-events.ts';
import { processDraftsOf } from '../reactions/process-drafts-of.ts';
import type { Unit } from '../storage/unit.ts';
import { completeJobHere } from '../worker/complete-job-here.ts';
import { appendEvents } from './append-events.ts';
import { appendReceiptChange } from './append-receipt-change.ts';
import { appendStreamRecords } from './append-stream-records.ts';
import { chargeUsage } from './charge-usage.ts';
import { checkWrittenItems } from './check-written-items.ts';
import { commandOutput } from './command-output.ts';
import { decisionDigest } from './decision-digest.ts';
import { defaultNodeId } from './default-node-id.ts';
import { draftsToEvents } from './drafts-to-events.ts';
import { handleDecision } from './handle-decision.ts';
import { insertPendingReceipt } from './insert-pending-receipt.ts';
import { loadCommandTarget } from './load-command-target.ts';
import { mergedFlagReads } from './merged-flag-reads.ts';
import { nestedFingerprint } from './nested-fingerprint.ts';
import { normalizeDecision } from './normalize-decision.ts';
import { openDecision } from './open-decision.ts';
import { openReactionJob } from './open-reaction-job.ts';
import type { PreparedRun } from './prepared-run.ts';
import { receiptGone } from './receipt-gone.ts';
import { receiptRow } from './receipt-row.ts';
import { receiptWindowMs } from './receipt-window-ms.ts';
import { refuseGeneratedWrite } from './refuse-generated-write.ts';
import { replayReceipt } from './replay-receipt.ts';
import type { RunCommandInput } from './run-command-input.ts';
import { runInUnitKeys } from './run-in-unit-keys.ts';
import { sealCommandOutput } from './seal-command-output.ts';
import { sealDecisionParts } from './seal-decision-parts.ts';
import { sealDrafts } from './seal-drafts.ts';
import { stateSealKeyOf } from './state-seal-key-of.ts';
import { writeStateRows } from './write-state-rows.ts';

/** What one attempt of a command runs with. */
export interface AttemptInput {
  readonly run: RunCommandInput;
  readonly commandId: string;
  /** The receipt's fingerprint (`kwf1.`). */
  readonly fingerprint: string;
  /** The decision base (`kwb1.`): the base of the event meta's inputDigest. */
  readonly decisionBase: string;
  /** The 0.1.0 form of the command's fingerprint, computed only to compare a receipt of 0.1.0. */
  readonly legacyFingerprint: () => string;
  /** The invocation's clock: one instant for every attempt. */
  readonly clock: Clock;
  readonly prepared: unknown;
  /** What `prepare` produced: its record joins the decision record, its flags `meta.flags`. */
  readonly preparedRun?: PreparedRun;
  /**
   * An `invoke` runs the command nested: how deep, the command that invoked it, and whether the
   * unit it runs in declares no storage limit (decided by the command the unit was opened for).
   */
  readonly nested?: {
    readonly depth: number;
    readonly causationId: string;
    readonly unitExempt: boolean;
  };
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
  refuseGeneratedWrite(run, input.nested);
  const now = clock.now();
  // Decided once, for the command the unit was opened for, and handed on to what runs in it.
  const unitExempt = input.nested?.unitExempt ?? isUnitExemptFromTail(action);

  const job = input.nested === undefined ? run.job : undefined;
  // A nested command is caused by the command that invoked it; a continuation job by its effect.
  const causationId = input.nested?.causationId ?? job?.causationId ?? run.causationId;
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
  const pending = await insertPendingReceipt(unit, receipt, {
    takeOver: job !== undefined,
    legacyFingerprint: input.legacyFingerprint,
  });
  if (pending.kind === 'inserted' && run.replayOnly === true) {
    throw receiptGone();
  }
  if (pending.kind === 'replay') {
    const replayed = await replayReceipt(unit, registry, action, authority, pending.receipt, job);
    if (job !== undefined) await completeJobHere(unit, job, action.scope, { kind: 'succeeded' });
    return replayed;
  }

  const { entry, target, reads: targetReads, loaded } = await loadCommandTarget(unit, run);

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
  const generated = action.generated === undefined ? undefined : generatedEntity(registry, action);
  const handled =
    opened === undefined
      ? await handleDecision({
          run,
          unit,
          decision,
          ...(entry === undefined || target === undefined
            ? {}
            : { target: { entry, row: target } }),
        })
      : opened.decide(decision.ctx);
  const decided = normalizeDecision(await decision.drive(handled));
  run.signal?.throwIfAborted();

  const reads = [...targetReads, ...decision.reads];
  const flags = mergedFlagReads(input.preparedRun, decision.flags);
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
  const { answers, sealedRequest, sealedInput } = await sealDecisionParts({
    unit,
    run,
    commandId,
    decision,
    preparedRun: input.preparedRun,
    sealedVerifiers,
  });
  // What both metas of this run share; the lineage is the running job's (a nested command reads its
  // outer run's job), so the events written carry it unchanged (7.7).
  const metaBase = {
    principal: run.principal,
    commandId,
    action: action.ref,
    correlationId: run.correlationId ?? run.request.requestId,
    build: run.build,
    lineage: run.job?.lineage,
  };
  const written = await draftsToEvents({
    unit,
    registry,
    behaviours: run.behaviours,
    drafts,
    authority,
    now,
    meta: (recorded, sealed) => {
      meta = buildEventMeta({
        ...metaBase,
        ...(causationId === undefined ? {} : { causationId }),
        ...(run.client === undefined ? {} : { client: run.client }),
        ...(run.traceparent === undefined ? {} : { traceparent: run.traceparent }),
        flags,
        decision: buildDecisionRecord({
          part: action.ref,
          inputDigest: decisionDigest(input.decisionBase, sealed),
          reads: recorded,
          answers,
          ...(sealedInput === undefined ? {} : { input: sealedInput }),
          effects: plannedEffects,
          ...(input.preparedRun === undefined ? {} : { prepare: input.preparedRun.record }),
          ...(sealedRequest === undefined ? {} : { request: sealedRequest }),
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
  chargeUsage(
    unit,
    chargeStorage({
      registry,
      scope: run.scope,
      written,
      quotas: run.quotas,
      exempt: isExemptFromTail(action, unitExempt),
    }),
  );
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
    unitExempt,
    ...(opened?.event === undefined
      ? {}
      : { cause: { eventId: opened.event.id, actor: opened.event.actor } }),
    runNested: async (nestedUnit, nestedRun, nested) => {
      const { fingerprintKey } = nestedRun;
      if (fingerprintKey === undefined)
        throw errors.internal('the nested run has no fingerprint key');
      return attemptCommand(
        {
          run: nestedRun,
          commandId: nested.commandId,
          ...nestedFingerprint({ ...nestedRun, fingerprintKey }),
          clock,
          prepared: undefined,
          nested: { ...nested, unitExempt },
        },
        nestedUnit,
      );
    },
  });
  const result =
    action.generated === 'set' && generated !== undefined
      ? setResultWithState(run, unit, generated, decided.result, await stateSealKeyOf(run))
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
  await unit.receipts.complete(commandId, sealedOutcome, receipt.expiresAt);
  if (job !== undefined) {
    if (pending.kind === 'taken') {
      await appendReceiptChange(unit, {
        registry,
        scope: run.scope,
        receipt: { ...receipt, status: 'completed', outcome: sealedOutcome },
        meta: buildEventMeta({ ...metaBase, flags: [], decision: null }),
        hybridClock: processClock,
        now,
      });
    }
    await completeJobHere(unit, job, action.scope, { kind: 'succeeded' });
  }
  return { output, ...(effects.length > 0 ? { effects } : {}) };
}
