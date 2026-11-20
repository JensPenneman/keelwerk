import { openStoredEvents } from '../encryption/open-stored-events.ts';
import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import { verifyChain } from '../events/verify-chain.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import { foldStoredEvent } from './fold-stored-event.ts';

const pageSize = 500;

/** The events of every stream of the entity in the unit's scope, grouped by stream in the order of each stream's first position. */
async function streamsOf(unit: Unit, entry: EntityEntry): Promise<Map<string, StoredEvent[]>> {
  const streams = new Map<string, StoredEvent[]>();
  let after: bigint | null = null;
  for (;;) {
    const batch = await unit.events.readAll(after, {
      limit: pageSize,
      includeTransient: true,
      selector: { streamTypes: [entry.ref] },
    });
    for (const event of batch.events) {
      const stream = streams.get(event.stream.id);
      if (stream === undefined) streams.set(event.stream.id, [event]);
      else stream.push(event);
    }
    if (batch.next === null || batch.events.length === 0) return streams;
    after = batch.next;
  }
}

/**
 * The row of every stream of a chain entity, folded from its events in the unit's scope, by stream id
 * in the order of the streams' first positions. Each stream must start at version 1 with no gap and
 * pass `verifyChain` on the events as stored; its personal values are opened before the fold.
 * Rejects with `unsupported` otherwise.
 */
export async function foldedStreams(
  unit: Unit,
  entry: EntityEntry,
  behaviours: EntityBehaviours,
): Promise<ReadonlyMap<string, StorageRow>> {
  const folded = new Map<string, StorageRow>();
  for (const [id, events] of await streamsOf(unit, entry)) {
    const where = `The stream ${entry.ref}/${id}`;
    if (!events.every((event, index) => event.version === index + 1)) {
      throw errors.unsupported(
        `${where} is not kept unbroken from version 1, so it cannot be folded.`,
      );
    }
    const verdict = verifyChain(events);
    if (!verdict.ok) {
      throw errors.unsupported(
        `${where} fails its chain at version ${verdict.version} (${verdict.reason}), so it cannot be folded.`,
      );
    }
    let state: StorageRow | undefined;
    for (const event of await openStoredEvents(unit, events)) {
      state = foldStoredEvent(entry, behaviours, state, event);
    }
    if (state !== undefined) folded.set(id, state);
  }
  return folded;
}
