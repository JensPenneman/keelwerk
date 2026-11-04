import { runKernelEffects } from '../effects/run-kernel-effects.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { DecisionRecord } from '../events/decision-record.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import type { Clock } from '../kernel/clock.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { appendEvents } from './append-events.ts';
import { checkWrittenItems } from './check-written-items.ts';
import { commandOutput } from './command-output.ts';
import { defaultNodeId } from './default-node-id.ts';
import { draftsToEvents } from './drafts-to-events.ts';
import { insertPendingReceipt } from './insert-pending-receipt.ts';
import { loadTarget } from './load-target.ts';
import { normalizeDecision } from './normalize-decision.ts';
import { openDecision } from './open-decision.ts';
import { receiptRow } from './receipt-row.ts';
import { replayReceipt } from './replay-receipt.ts';
import type { RunCommandInput } from './run-command-input.ts';
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
}

/**
 * Phases 3 to 7 of section 7.9.4 in one unit: the pending receipt, the target and its lock, the
 * decision driven with its requests answered, the drafts evolved, written and item-checked, the
 * kernel effects, and the completed receipt. Any failure throws and the unit rolls back, the
 * receipt with it.
 */
export async function attemptCommand(input: AttemptInput, unit: Unit): Promise<CommandResult> {
  const { run, commandId, fingerprint, clock } = input;
  const { action, registry } = run;
  const authority = action.contributedBy ?? action.module;
  const now = clock.now();

  const pending = await insertPendingReceipt(
    unit,
    receiptRow({
      commandId,
      action: action.ref,
      fingerprint,
      principal: run.principal,
      apiVersion: run.apiVersion,
      request: run.request,
      ...(run.client === undefined ? {} : { client: run.client }),
      now,
    }),
  );
  if (pending.kind === 'replay')
    return replayReceipt(unit, registry, action, authority, pending.receipt);

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
    });
    loaded.set(`${entry.ref}/${String(target.id)}`, target);
  }

  const decision = openDecision({
    run,
    unit,
    form: 'decide',
    clock,
    prepared: input.prepared,
    ...(entry === undefined || target === undefined ? {} : { target: { entry, row: target } }),
  });
  let handled: unknown;
  if (entry !== undefined && target !== undefined) {
    const { id: _id, ifVersion: _ifVersion, ...rest } = run.input as Record<string, unknown>;
    handled = action.handler(rest, decodeRow(entry, target, authority), decision.ctx);
  } else {
    handled = action.handler(run.input, decision.ctx);
  }
  const decided = normalizeDecision(await decision.drive(handled));
  run.signal?.throwIfAborted();

  const reads = [...targetReads, ...decision.reads];
  const record: DecisionRecord = {
    part: action.ref,
    inputDigest: fingerprint,
    reads,
    answers: decision.answers,
    effects: [],
  };
  const meta = buildEventMeta({
    principal: run.principal,
    commandId,
    action: action.ref,
    correlationId: run.correlationId ?? run.request.requestId,
    ...(run.client === undefined ? {} : { client: run.client }),
    ...(run.traceparent === undefined ? {} : { traceparent: run.traceparent }),
    build: run.build,
    flags: [...decision.flags.values()],
    decision: record,
  });
  const drafts = await sealDrafts({ registry, unit, drafts: decided.drafts });
  const written = await draftsToEvents({
    unit,
    registry,
    behaviours: run.behaviours,
    drafts,
    authority,
    now,
    meta,
    reads,
    loaded,
    counter: { next: 0 },
    nodeId: run.nodeId ?? defaultNodeId,
  });
  await writeStateRows(unit, written);
  await appendEvents(unit, written);
  await checkWrittenItems({
    unit,
    registry,
    rules: run.rules,
    action,
    principal: run.principal,
    scope: run.scope,
    written,
  });

  const effects = await runKernelEffects({ unit, effects: decided.effects, commandId });
  const { output, outcome } = commandOutput({
    registry,
    action,
    authority,
    written,
    target,
    result: decided.result,
    effects,
  });
  run.signal?.throwIfAborted();
  await unit.receipts.complete(commandId, outcome);
  return { output, ...(effects.length > 0 ? { effects } : {}) };
}
