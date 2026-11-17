import type { StoredEvent } from '../events/stored-event.ts';
import type { ReactionLineage } from './reaction-lineage.ts';
import { reactionLineageOf } from './reaction-lineage-of.ts';

/**
 * The lineage of a reaction job for `event`: the event's own lineage one deeper, with its origin,
 * or `{ depth: 1, origin: event.eventId }` for an event that is no part of a chain. This is the
 * only place a depth grows.
 */
export function nextReactionLineage(
  event: Pick<StoredEvent, 'eventId' | 'lineage'>,
): ReactionLineage {
  const current = reactionLineageOf(event.lineage);
  if (current === undefined) return { depth: 1, origin: event.eventId };
  return { depth: current.depth + 1, origin: current.origin };
}
