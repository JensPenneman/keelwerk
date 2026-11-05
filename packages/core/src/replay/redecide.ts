import { hybridClock } from '../clock/hybrid-clock.ts';
import { durationMs } from '../effects/duration-ms.ts';
import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { buildDecisionRecord } from '../events/build-decision-record.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import { encodeDecisionRecord } from '../events/encode-decision-record.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { commandFingerprint } from '../write-path/command-fingerprint.ts';
import { defaultNodeId } from '../write-path/default-node-id.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import { loadTarget } from '../write-path/load-target.ts';
import { normalizeDecision } from '../write-path/normalize-decision.ts';
import { openDecision } from '../write-path/open-decision.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { alignEvents } from './align-events.ts';
import { asOfAdapter } from './as-of-adapter.ts';
import type { AsOfContext } from './as-of-context.ts';
import { createAsOfReads } from './as-of-reads.ts';
import { asOfUnit } from './as-of-unit.ts';
import { commandEvents } from './command-events.ts';
import type { ComparableEvent } from './comparable-event.ts';
import { comparableOfStored } from './comparable-of-stored.ts';
import { comparableOfWritten } from './comparable-of-written.ts';
import { compareEvents } from './compare-events.ts';
import { defaultFeedHorizon } from './default-feed-horizon.ts';
import { principalOfActor } from './principal-of-actor.ts';
import type { RedecideInput } from './redecide-input.ts';
import type { RedecideResult } from './redecide-result.ts';
import { replayAnswerers } from './replay-answerers.ts';
import { replayReactions } from './replay-reactions.ts';
import { resolveReplayedDrafts } from './resolve-replayed-drafts.ts';

const refusals: ReadonlySet<string> = new Set([
  'core.replay_outside_horizon',
  'core.replay_key_destroyed',
]);

function isReplay(error: KeelwerkError, kind: 'mismatch' | 'unsupported'): boolean {
  return (
    typeof error.details === 'object' &&
    error.details !== null &&
    'replay' in error.details &&
    error.details.replay === kind
  );
}

async function replayIn(unit: Unit, input: RedecideInput): Promise<RedecideResult> {
  const { registry, commandId } = input;
  const events = await commandEvents(unit, commandId);
  const first = events[0];
  if (first === undefined)
    throw errors.not_found(`No events were recorded for command ${commandId}.`);
  const record = first.decision;
  if (record === null) {
    throw errors.validation(`Command ${commandId} left no decision record: it was kernel work.`);
  }
  const action = registry.actions.get(first.action ?? '');
  if (action === undefined || action.kind !== 'command') {
    throw errors.not_found(`"${first.action ?? ''}" is not a command of this app.`);
  }
  if (action.generated !== undefined || action.prepare !== undefined) {
    throw errors.not_implemented(
      `"${action.ref}" has a generated handler or a prepare; this release re-decides decide only.`,
    );
  }
  const fingerprint = await commandFingerprint({ ...input, action });
  if (fingerprint !== record.inputDigest) {
    throw errors.validation('The input is not the one the decision recorded.');
  }
  const authority = action.contributedBy ?? action.module;
  const principal = input.principal ?? principalOfActor(first.actor, input.scope);
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
    input: input.input,
    principal,
    request: { transport: 'replay', requestId: first.correlationId, ...input.request },
    clock,
    keys: input.keys,
    compute: input.compute,
    log: input.log,
    trace: input.trace,
    rules: input.rules,
    apiVersion: input.apiVersion,
    build,
    behaviours: input.behaviours,
    commandId,
    replace: replayAnswerers(record.answers),
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.concurrentUnits === undefined ? {} : { concurrentUnits: input.concurrentUnits }),
    ...(input.namespaceOf === undefined ? {} : { namespaceOf: input.namespaceOf }),
  };

  const own = events.filter((event) => event.action === first.action);
  const recordedEvents = events.map(comparableOfStored);
  // Compared opened (personal values readable) and aligned on what stays sealed (S-82); shown as stored.
  const sealer = personalSealerOf(unit);
  const openedEvents = sealer === undefined ? events : await sealer.openEvents(events);
  const recordedOpened = openedEvents.map(comparableOfStored);
  const recordedRecord = encodeDecisionRecord(record);
  const failed = (message: string, refused?: string): RedecideResult => ({
    commandId,
    part: action.ref,
    reproduced: false,
    differences: [message],
    ...(refused === undefined ? {} : { refused }),
    recorded: { events: recordedEvents, effects: record.effects, decision: recordedRecord },
    redecided: { events: [], effects: [] },
  });

  try {
    const targetReads: RecordedRead[] = [];
    const loaded = new Map<string, StorageRow>();
    const entry =
      action.instance && action.entity !== undefined
        ? registry.entities.get(action.entity)
        : undefined;
    let target: StorageRow | undefined;
    if (action.instance) {
      if (entry === undefined)
        throw errors.internal(`"${action.ref}" is an entity command without an entity.`);
      target = await loadTarget({
        unit: view,
        registry,
        rules: input.rules,
        action,
        entry,
        principal,
        scope: input.scope,
        input: input.input,
        reads: targetReads,
      });
      loaded.set(`${entry.ref}/${String(target.id)}`, target);
    }
    const decision = openDecision({
      run,
      unit: view,
      form: 'decide',
      clock,
      ...(entry === undefined || target === undefined ? {} : { target: { entry, row: target } }),
    });
    let handled: unknown;
    if (entry !== undefined && target !== undefined) {
      const { id: _id, ifVersion: _ifVersion, ...rest } = input.input as Record<string, unknown>;
      handled = action.handler(rest, decodeRow(entry, target, authority), decision.ctx);
    } else {
      handled = action.handler(input.input, decision.ctx);
    }
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
    const sameEffectCount = decided.effects.length === record.effects.length;
    const flags = [...decision.flags.values()];
    const redecidedRecord = buildDecisionRecord({
      part: action.ref,
      inputDigest: fingerprint,
      reads,
      answers: decision.answers,
      effects: sameEffectCount ? record.effects : [],
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
      recorded: events.filter((event) => event.action !== first.action),
      latest: events.at(-1)?.position ?? 0n,
    });
    const redecidedEvents = [...comparableOfWritten(written), ...reactions.events];
    const alignedTo = (base: readonly ComparableEvent[]) => alignEvents(redecidedEvents, base);
    const differences = [
      ...compareEvents(recordedOpened, alignedTo(recordedOpened)),
      ...reactions.differences,
    ];
    if (!sameEffectCount) {
      differences.push(
        `${record.effects.length} effects were recorded and ${decided.effects.length} were re-decided`,
      );
    }
    const encoded = encodeDecisionRecord(redecidedRecord);
    for (const member of ['reads', 'answers', 'effects'] as const) {
      if (canonicalizeJson(encoded[member]) !== canonicalizeJson(recordedRecord[member])) {
        differences.push(`the decision record's ${member} differ`);
      }
    }
    if (canonicalizeJson(meta.flags) !== canonicalizeJson(first.flags)) {
      differences.push('the flags the decision read differ');
    }
    return {
      commandId,
      part: action.ref,
      reproduced: differences.length === 0,
      differences,
      recorded: { events: recordedEvents, effects: record.effects, decision: recordedRecord },
      redecided: {
        events: alignedTo(recordedEvents),
        effects: decided.effects.map((effect) => effect.kind),
        decision: encoded,
        result: decided.result,
      },
    };
  } catch (error) {
    if (!(error instanceof KeelwerkError)) throw error;
    if (isReplay(error, 'mismatch')) return failed(error.message);
    if (isReplay(error, 'unsupported')) {
      return failed(
        `cannot re-decide: ${error.message}`,
        refusals.has(error.code) ? error.code : undefined,
      );
    }
    return failed(`the handler now fails with ${error.code}: ${error.message}`);
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
export function redecide(input: RedecideInput): Promise<RedecideResult> {
  return input.adapter.unit(input.namespace, input.scope, (unit) => replayIn(unit, input), {
    readOnly: true,
  });
}
