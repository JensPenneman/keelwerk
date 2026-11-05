import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { applyDomainEvolve } from '../write-path/apply-domain-evolve.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import type { EvolvingEvent } from '../write-path/evolving-event.ts';
import { genericEvolve } from '../write-path/generic-evolve.ts';

const generatedEvents = new Set(['created', 'imported', 'changed', 'archived', 'restored']);

/**
 * The row after one stored event, by the generic evolve and the author's, the way a rebuild folds
 * a stream; `state` is the row before it, absent for the first event.
 */
export function foldStoredEvent(
  entry: EntityEntry,
  behaviours: EntityBehaviours,
  state: StorageRow | undefined,
  event: StoredEvent,
): StorageRow {
  const id = event.stream.id;
  const name = event.type.slice(entry.ref.length + 1);
  const evolving: EvolvingEvent = {
    id,
    name,
    data: event.data,
    recordedAt: event.recordedAt,
    hlc: event.hlc,
    hash: event.hash,
  };
  if (generatedEvents.has(name)) return genericEvolve(entry, state, evolving);
  if (state === undefined)
    throw errors.internal(`the stream ${entry.ref}/${id} starts with "${name}"`);
  return applyDomainEvolve(entry, behaviours(entry.ref), state, evolving, event.data);
}
