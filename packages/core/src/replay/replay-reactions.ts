import { hybridClock } from '../clock/hybrid-clock.ts';
import { sha256 } from '../crypto/sha256.ts';
import { buildDecisionRecord } from '../events/build-decision-record.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import { encodeDecisionRecord } from '../events/encode-decision-record.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { Clock } from '../kernel/clock.ts';
import { inlineReactionsOf } from '../reactions/inline-reactions-of.ts';
import { maxReactionDepth } from '../reactions/max-reaction-depth.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { reactionActionOf } from '../reactions/reaction-action-of.ts';
import { reactionDepthError } from '../reactions/reaction-depth-error.ts';
import { reactionEventsOf } from '../reactions/reaction-events-of.ts';
import { reactionMatches } from '../registry/reaction-matches.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { Position } from '../storage/position.ts';
import type { Unit } from '../storage/unit.ts';
import { defaultNodeId } from '../write-path/default-node-id.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import { normalizeDecision } from '../write-path/normalize-decision.ts';
import { openDecision } from '../write-path/open-decision.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import { asOfAdapter } from './as-of-adapter.ts';
import type { AsOfContext } from './as-of-context.ts';
import { type AsOfReads, createAsOfReads } from './as-of-reads.ts';
import { asOfUnit } from './as-of-unit.ts';
import type { ComparableEvent } from './comparable-event.ts';
import { comparableOfWritten } from './comparable-of-written.ts';
import { replayAnswerers } from './replay-answerers.ts';
import { resolveReplayedDrafts } from './resolve-replayed-drafts.ts';

/** The recorded reaction events grouped by decision: consecutive events of one reaction caused by one event. */
function groupsOf(recorded: readonly StoredEvent[]): StoredEvent[][] {
  const groups: StoredEvent[][] = [];
  for (const event of recorded) {
    const last = groups.at(-1);
    const head = last?.[0];
    if (
      last !== undefined &&
      head?.action === event.action &&
      head?.causationId === event.causationId
    ) {
      last.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups;
}

/** What the inline reactions of a re-decide take. */
export interface ReplayReactionsInput {
  /** The real unit. */
  readonly unit: Unit;
  /** The real adapter: a reaction's second units are views of it, over its own reads. */
  readonly adapter: DataAdapter;
  /** The command's run: the reactions run under it with their own action, principal and answers. */
  readonly run: RunCommandInput;
  /** The command's as-of context; each reaction swaps in the reads of its own decision. */
  readonly context: AsOfContext;
  readonly clock: Clock;
  readonly commandId: string;
  readonly correlationId: string;
  /** What the command's own decision wrote, re-decided. */
  readonly written: readonly WrittenRow[];
  /** The command's own stored events, in the order of `written`. */
  readonly own: readonly StoredEvent[];
  /** The stored events the inline reactions of the command wrote, in write order. */
  readonly recorded: readonly StoredEvent[];
  /** The last position the command wrote: where a reaction without a record read. */
  readonly latest: Position;
}

/** The events the reactions now write, and how their decisions differ from the recorded ones. */
export interface ReplayedReactions {
  readonly events: readonly ComparableEvent[];
  readonly differences: readonly string[];
}

/**
 * Re-decides the inline reactions a command triggered (section 7.7), in the order the kernel ran
 * them: for each event written, the reactions that listen to it in module order, each under its
 * module's service principal with the reads and answers of its own recorded decision, and the
 * events they write reacted to in turn. A reaction that wrote nothing left no record, so it reads
 * as of the end of the command. Events and decision records are compared with the stored ones.
 */
export async function replayReactions(input: ReplayReactionsInput): Promise<ReplayedReactions> {
  const { run, context, unit } = input;
  const groups = groupsOf(input.recorded);
  let cursor = 0;
  const events: ComparableEvent[] = [];
  const differences: string[] = [];
  const recordedIds = new Map<string, string>();
  const remember = (written: readonly WrittenRow[], stored: readonly StoredEvent[]) => {
    written
      .flatMap((row) => row.events.map((event) => event.eventId))
      .forEach((id, index) => {
        const was = stored[index];
        if (was !== undefined) recordedIds.set(id, was.eventId);
      });
  };
  remember(input.written, input.own);

  const dispatch = async (written: readonly WrittenRow[], depth: number): Promise<void> => {
    const reactions = inlineReactionsOf(run.registry);
    const seen = new Map(
      reactions.map(
        (reaction) => [reaction.id, reactionEventsOf(written, reaction.module)] as const,
      ),
    );
    const count = Math.max(0, ...[...seen.values()].map((list) => list.length));
    for (let index = 0; index < count; index += 1) {
      for (const reaction of reactions) {
        const event = seen.get(reaction.id)?.[index];
        if (event === undefined || !reactionMatches(reaction, event.type)) continue;
        if (depth > maxReactionDepth) throw reactionDepthError(`The reaction "${reaction.id}"`);
        const cause = recordedIds.get(event.id) ?? event.id;
        const group = groups[cursor];
        const matched =
          group?.[0]?.action === reaction.id && group[0].causationId === cause ? group : undefined;
        const record = matched?.[0]?.decision ?? undefined;
        const reads: AsOfReads =
          record === undefined
            ? { take: () => ({ at: input.latest }), ceiling: () => input.latest }
            : createAsOfReads(record.reads, run.scope.level);
        const reactionContext: AsOfContext = { ...context, reads };
        const principal = moduleServicePrincipal(reaction.module, run.principal);
        const reactionRun: RunCommandInput = {
          ...run,
          action: reactionActionOf(reaction, run.action),
          principal,
          adapter: asOfAdapter(input.adapter, reactionContext),
          replace: replayAnswerers(record?.answers ?? []),
        };
        const view = asOfUnit(unit, reactionContext);
        const decision = openDecision({
          run: reactionRun,
          unit: view,
          form: 'decide',
          clock: input.clock,
        });
        const decided = normalizeDecision(
          await decision.drive(reaction.react(event, decision.ctx)),
        );
        if (decided.drafts.length === 0) continue;
        const readsOut = [...decision.reads];
        const resolved = await resolveReplayedDrafts({
          unit,
          registry: run.registry,
          behaviours: run.behaviours,
          drafts: decided.drafts,
          loaded: new Map(),
          reads: readsOut,
          recorded: record?.reads ?? [],
          ceiling: reads.ceiling(),
          horizon: context.feedHorizon,
        });
        const redecided = buildDecisionRecord({
          part: reaction.id,
          inputDigest: sha256(cause),
          reads: readsOut,
          answers: decision.answers,
          effects: decided.effects.length === record?.effects.length ? record.effects : [],
        });
        const meta = buildEventMeta({
          principal,
          commandId: input.commandId,
          action: reaction.id,
          correlationId: input.correlationId,
          causationId: event.id,
          build: run.build,
          flags: [...decision.flags.values()],
          decision: redecided,
        });
        const wrote = await draftsToEvents({
          unit: view,
          registry: run.registry,
          behaviours: run.behaviours,
          drafts: decided.drafts,
          authority: reaction.module,
          now: input.clock.now(),
          meta: () => meta,
          reads: readsOut,
          loaded: resolved,
          hybridClock: hybridClock(defaultNodeId),
          sealEvents: false,
        });
        events.push(...comparableOfWritten(wrote));
        if (matched === undefined || record === undefined) {
          differences.push(`${reaction.id} now writes events the record lacks`);
        } else {
          cursor += 1;
          remember(wrote, matched);
          if (decided.effects.length !== record.effects.length) {
            differences.push(`${reaction.id}: the effects differ in number`);
          }
          const now = encodeDecisionRecord(redecided);
          const was = encodeDecisionRecord(record);
          for (const member of ['reads', 'answers', 'effects'] as const) {
            if (canonicalizeJson(now[member]) !== canonicalizeJson(was[member])) {
              differences.push(`the decision record's ${member} differ (${reaction.id})`);
            }
          }
        }
        await dispatch(wrote, depth + 1);
      }
    }
  };
  await dispatch(input.written, 1);
  if (cursor < groups.length) {
    differences.push(`${groups.length - cursor} recorded reaction decisions were not re-decided`);
  }
  return { events, differences };
}
