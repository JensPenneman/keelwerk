import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { Unit } from '../storage/unit.ts';
import { appendProcessEvents } from './append-process-events.ts';
import type { OpenedAsyncReaction } from './open-async-reaction.ts';

/** Appends the events a process's decision holds for its own stream, after the entity events; nothing for a job without a process or a decision without such events. */
export async function appendReactionProcessEvents(input: {
  readonly unit: Unit;
  readonly opened: OpenedAsyncReaction | undefined;
  readonly drafts: readonly EventDraft[];
  readonly meta: EventMeta;
  readonly hybridClock: HybridClock;
  readonly now: Temporal.Instant;
}): Promise<void> {
  const { opened, drafts } = input;
  if (opened?.process === undefined || drafts.length === 0) return;
  await appendProcessEvents({
    unit: input.unit,
    reaction: opened.reaction,
    folded: opened.process,
    drafts,
    meta: input.meta,
    hybridClock: input.hybridClock,
    now: input.now,
  });
}
