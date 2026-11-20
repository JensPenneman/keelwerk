import { hybridClock } from '../clock/hybrid-clock.ts';
import { durationMs } from '../effects/duration-ms.ts';
import { plannedEffectIds } from '../effects/planned-effect-ids.ts';
import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { buildDecisionRecord } from '../events/build-decision-record.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import { encodeDecisionRecord } from '../events/encode-decision-record.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { shownDecisionRecord } from '../explain/shown-decision-record.ts';
import { recordedFlagSnapshot } from '../flags/recorded-flag-snapshot.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { deriveScopeSecrets } from '../keys/derive-scope-secrets.ts';
import type { ScopeSecrets } from '../keys/scope-secrets.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { defaultNodeId } from '../write-path/default-node-id.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import { handleDecision } from '../write-path/handle-decision.ts';
import { mergedFlagReads } from '../write-path/merged-flag-reads.ts';
import { mergedRequestReads } from '../write-path/merged-request-reads.ts';
import { normalizeDecision } from '../write-path/normalize-decision.ts';
import { openDecision } from '../write-path/open-decision.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { alignEvents } from './align-events.ts';
import { asOfAdapter } from './as-of-adapter.ts';
import type { AsOfContext } from './as-of-context.ts';
import { createAsOfReads } from './as-of-reads.ts';
import { asOfUnit } from './as-of-unit.ts';
import { checkRecordedInput } from './check-recorded-input.ts';
import { commandEvents } from './command-events.ts';
import { comparableOfStored } from './comparable-of-stored.ts';
import { comparableOfWritten } from './comparable-of-written.ts';
import { compareEvents } from './compare-events.ts';
import { decisionEvents } from './decision-events.ts';
import { decisionRecordDifferences } from './decision-record-differences.ts';
import { defaultFeedHorizon } from './default-feed-horizon.ts';
import { deferredEffectDifferences } from './deferred-effect-differences.ts';
import { principalOfActor } from './principal-of-actor.ts';
import { recordedInputOf } from './recorded-input-of.ts';
import { recordedRequestOf } from './recorded-request-of.ts';
import type { RedecideInput } from './redecide-input.ts';
import type { RedecideResult } from './redecide-result.ts';
import { replayAnswerers } from './replay-answerers.ts';
import { replayDeclaredPrepare } from './replay-declared-prepare.ts';
import { replayFailure } from './replay-failure.ts';
import { replayReactions } from './replay-reactions.ts';
import { replayTarget } from './replay-target.ts';
import { resolveReplayedDrafts } from './resolve-replayed-drafts.ts';
import { withoutPersonalBefore } from './without-personal-before.ts';

async function replayIn(
  unit: Unit,
  input: RedecideInput,
  secrets: ScopeSecrets,
): Promise<RedecideResult> {
  const { registry, commandId } = input;
  const all = await commandEvents(unit, commandId);
  if (all.length === 0) throw errors.not_found(`No events were recorded for command ${commandId}.`);
  // Only the events that carry the decision record belong to the decision: receipt change records,
  // inline effect records and settled records carry none (7.9.6; their versions may restart).
  const events = decisionEvents(all);
  const first = events[0];
  const record = first?.decision;
  if (first === undefined || record === null || record === undefined) {
    throw errors.validation(
      `Command ${commandId} wrote no events with a decision record (7.9.6); its inline effects are in core.effect.`,
    );
  }
  const action = registry.actions.get(first.action ?? '');
  if (action === undefined || action.kind !== 'command') {
    throw errors.not_found(`"${first.action ?? ''}" is not a command of this app.`);
  }
  const given = await recordedInputOf(unit, record, commandId, input.input);
  const source = { ...input, input: given, action, fingerprintKey: secrets.fingerprintKey };
  await checkRecordedInput(unit, source, events, record.inputDigest);
  const authority = action.contributedBy ?? action.module;
  const principal = input.principal ?? principalOfActor(first.actor, input.scope);
  const recordedRequest = await recordedRequestOf(
    unit,
    record,
    commandId,
    first.correlationId,
    input.request,
  );
  const context: AsOfContext = {
    registry,
    behaviours: input.behaviours,
    reads: createAsOfReads(record.reads, input.scope.level),
    feedHorizon: {
      decidedAt: first.recordedAt,
      retainedSince: Temporal.Instant.fromEpochMilliseconds(
        input.clock.now().epochMilliseconds - durationMs(input.feedHorizon ?? defaultFeedHorizon),
      ),
    },
  };
  const view = asOfUnit(unit, context);
  const clock = { now: () => first.recordedAt };
  const build = { id: first.writer.build, revision: first.writer.revision };
  const run: RunCommandInput = {
    registry,
    adapter: asOfAdapter(input.adapter, context),
    namespace: input.namespace,
    scope: input.scope,
    action,
    input: given,
    principal,
    request: recordedRequest.request,
    clock,
    keys: input.keys,
    jobKeySecret: secrets.jobKey,
    fingerprintKey: secrets.fingerprintKey,
    stateSealKey: secrets.stateTokenKey,
    compute: input.compute,
    log: input.log,
    trace: input.trace,
    rules: input.rules,
    flags: recordedFlagSnapshot(registry, first.flags),
    apiVersion: input.apiVersion,
    build,
    behaviours: input.behaviours,
    commandId,
    replace: replayAnswerers(record.answers),
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.concurrentUnits === undefined ? {} : { concurrentUnits: input.concurrentUnits }),
    ...(input.namespaceOf === undefined ? {} : { namespaceOf: input.namespaceOf }),
  };

  // The effects a decision requested are compared by their ids in the record, not as events.
  const compared = events.filter((event) => event.stream.type !== 'core.effect');
  const own = compared.filter((event) => event.action === first.action);
  const recordedEvents = compared.map(comparableOfStored);
  // Compared opened (personal values readable) and aligned on what stays sealed (S-82); shown as
  // stored. By presence the sealed events stand in for the opened ones and the personal fields of
  // every before-image are left out of the compared events and of the re-decided events shown: no
  // guess is told apart.
  const sealer = personalSealerOf(unit);
  const byPresence = input.personalByPresence === true;
  const recordedBase =
    sealer === undefined || byPresence
      ? recordedEvents
      : (await sealer.openEvents(compared)).map(comparableOfStored);
  const recordedRecord = encodeDecisionRecord(record);
  const failed = (message: string, refused?: string): RedecideResult => ({
    commandId,
    part: action.ref,
    reproduced: false,
    differences: [message],
    ...(refused === undefined ? {} : { refused }),
    recorded: {
      events: recordedEvents,
      effects: record.effects,
      decision: shownDecisionRecord(recordedRecord),
    },
    redecided: { events: [], effects: [] },
  });

  try {
    const targetReads: RecordedRead[] = [];
    const loaded = new Map<string, StorageRow>();
    const target = await replayTarget(view, run, targetReads);
    if (target !== undefined)
      loaded.set(`${target.entry.ref}/${String(target.row.id)}`, target.row);
    // A recorded prepare is replayed first (D3): its value is what decide sees as `ctx.prepared`.
    const { prepared, difference } = await replayDeclaredPrepare({
      run: { ...run, adapter: input.adapter },
      unit,
      context,
      record,
      commandId,
      input: given,
      ...(byPresence ? { personalByPresence: true } : {}),
    });
    const differences: string[] = difference === undefined ? [] : [difference];
    const decision = openDecision({
      run,
      unit: view,
      form: 'decide',
      clock,
      prepared: prepared?.value,
      ...(target === undefined ? {} : { target }),
    });
    const handled = await handleDecision({
      run,
      unit: view,
      decision,
      ...(target === undefined ? {} : { target }),
    });
    const decided = normalizeDecision(await decision.drive(handled));

    const reads = [...targetReads, ...decision.reads];
    const resolved = await resolveReplayedDrafts({
      unit,
      registry,
      behaviours: input.behaviours,
      drafts: decided.drafts,
      loaded,
      reads,
      recorded: record.reads,
      ceiling: context.reads.ceiling(),
      horizon: context.feedHorizon,
    });
    const flags = mergedFlagReads(prepared, decision.flags);
    const requestRead = mergedRequestReads(prepared?.request, decision.request());
    const redecidedRecord = buildDecisionRecord({
      part: action.ref,
      inputDigest: record.inputDigest,
      reads,
      answers: decision.answers,
      effects: plannedEffectIds(input.scope, commandId, decided.effects),
      ...(prepared === undefined ? {} : { prepare: prepared.record }),
      // Compared by presence: the sealed value of the record stands in for the read one.
      ...(requestRead === undefined || record.request === undefined
        ? {}
        : { request: record.request }),
    });
    const meta = buildEventMeta({
      principal,
      commandId,
      action: action.ref,
      correlationId: first.correlationId,
      ...(first.client === null ? {} : { client: first.client }),
      ...(first.traceparent === null ? {} : { traceparent: first.traceparent }),
      build,
      flags,
      decision: redecidedRecord,
    });
    const written = await draftsToEvents({
      unit: view,
      registry,
      behaviours: input.behaviours,
      drafts: decided.drafts,
      authority,
      now: clock.now(),
      meta: () => meta,
      reads,
      loaded: resolved,
      hybridClock: hybridClock(defaultNodeId),
      sealEvents: false,
    });
    const reactions = await replayReactions({
      unit,
      adapter: input.adapter,
      run,
      context,
      clock,
      commandId,
      correlationId: first.correlationId,
      written,
      own,
      recorded: compared.filter((event) => event.action !== first.action),
      latest: compared.at(-1)?.position ?? 0n,
    });
    const redecidedEvents = [...comparableOfWritten(written), ...reactions.events];
    const shownOf = withoutPersonalBefore(registry, byPresence);
    const alignedTo = (base: typeof recordedEvents) => shownOf(alignEvents(redecidedEvents, base));
    differences.push(
      ...compareEvents(shownOf(recordedBase), alignedTo(recordedBase)),
      ...reactions.differences,
    );
    differences.push(
      ...(await deferredEffectDifferences({
        unit,
        registry,
        scope: input.scope,
        commandId,
        effects: decided.effects,
        recorded: record.effects,
        ...(byPresence ? { personalByPresence: true } : {}),
      })),
    );
    const encoded = encodeDecisionRecord(redecidedRecord);
    differences.push(
      ...decisionRecordDifferences(encoded, recordedRecord, recordedRequest, requestRead),
    );
    if (canonicalizeJson(meta.flags) !== canonicalizeJson(first.flags)) {
      differences.push('the flags the decision read differ');
    }
    return {
      commandId,
      part: action.ref,
      reproduced: differences.length === 0,
      differences,
      recorded: {
        events: recordedEvents,
        effects: record.effects,
        decision: shownDecisionRecord(recordedRecord),
      },
      redecided: {
        events: alignedTo(recordedEvents),
        effects: decided.effects.map((effect) => effect.kind),
        decision: shownDecisionRecord(encoded),
        result: decided.result,
      },
    };
  } catch (error) {
    if (!(error instanceof KeelwerkError)) throw error;
    const failure = replayFailure(error);
    return failed(failure.message, failure.refused);
  }
}

/**
 * Re-decides a recorded command (section 7.9.6): runs its `decide` with the current build,
 * every load answered as of the positions the decision record holds and every id and random
 * value from the record, then compares the events, the effects, the decision record and the
 * flags with what was stored. Nothing is committed: the unit is read-only and the events are
 * built and dropped. A handler that fails or asks for more than the record holds is a
 * difference, not an exception.
 */
export async function redecide(input: RedecideInput): Promise<RedecideResult> {
  // Before the unit opens: a derivation inside it would open a second unit once the key service's
  // cache expired. The secrets are those of the scope the unit opens, whatever the input holds.
  // A re-decide only reads: a scope without a key is `not_found` here and is given none.
  const secrets = await deriveScopeSecrets(input.keys, input.scope, { create: false });
  return input.adapter.unit(
    input.namespace,
    input.scope,
    (unit) => replayIn(unit, input, secrets),
    {
      readOnly: true,
    },
  );
}
