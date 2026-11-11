import type { AnyDraft } from '../protocol/any-draft.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { OpenedAsyncReaction } from './open-async-reaction.ts';

/**
 * The drafts of a decision split in two: the events it holds for the process's own stream
 * (`ctx.events`, drafts of `event` kind whose entity is the process id), which `appendProcessEvents`
 * validates, seals under the instance and chains, and every other draft, which the entity write
 * path takes. Without a process the drafts are all the second kind.
 */
export function processDraftsOf(
  opened: OpenedAsyncReaction | undefined,
  drafts: readonly AnyDraft[],
): { readonly events: readonly EventDraft[]; readonly entities: readonly AnyDraft[] } {
  if (opened?.process === undefined) return { events: [], entities: drafts };
  const events = drafts.filter(
    (draft): draft is EventDraft => draft.kind === 'event' && draft.entity === opened.reaction.id,
  );
  return { events, entities: drafts.filter((draft) => !events.includes(draft as EventDraft)) };
}
