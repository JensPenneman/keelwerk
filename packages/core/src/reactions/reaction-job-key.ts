import type { StoredEvent } from '../events/stored-event.ts';
import type { JobSpec } from '../jobs/job-spec.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import { reactionKeyValue } from './reaction-key-value.ts';

/**
 * The key of a reaction's job (7.7; the format `<reaction id>:<sha256 of the part>` is stored and
 * final, see `reactionKeyValue`): an ordered reaction (`fifo-per-key`), a coalescing one or a
 * process groups by the key its `key(event)` declared, else by the event's stream, and any other
 * reaction by the event itself, so every event is its own job. A coalescing reaction replaces the
 * pending job of its key, and the later event wins (the store's own `coalesce` would keep the older
 * job and its older event); an ordered one appends, so every event of the key is decided in order;
 * any other keeps a pending job of the same event. A declared key that orders or coalesces nothing
 * has no queue meaning and is not used.
 */
export function reactionJobKey(
  reaction: ReactionEntry,
  event: StoredEvent,
  declared: string | undefined,
): NonNullable<JobSpec['key']> {
  const ordered = reaction.ordering === 'fifo-per-key' || reaction.coalesce;
  const part = ordered ? (declared ?? event.stream.id) : event.eventId;
  const onConflict = reaction.coalesce
    ? 'replace'
    : reaction.ordering === 'fifo-per-key'
      ? 'append'
      : 'keep';
  return { value: reactionKeyValue(reaction, part), onConflict };
}
