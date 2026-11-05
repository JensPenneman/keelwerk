import { openStoredEvents } from '../encryption/open-stored-events.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import type { FeedHorizon } from './feed-horizon.ts';
import { foldStoredEvent } from './fold-stored-event.ts';
import { readStateAsOfPosition } from './read-state-as-of-position.ts';
import { replayUnsupported } from './replay-unsupported.ts';

const pageSize = 500;

/** What an as-of read takes. */
export interface AsOfInput {
  /** A unit of the scope the entity lives in. */
  readonly unit: Unit;
  readonly entry: EntityEntry;
  readonly behaviours: EntityBehaviours;
  /** The last committed position of the scope the read sees (S-19, S-25). */
  readonly at: Position;
  /** A re-decide's feed horizon; a state read of a decision older than it is refused. */
  readonly horizon?: FeedHorizon;
}

/**
 * Every row of a chain entity as it was at a position of its scope (S-25): the streams folded
 * from their events up to and including `at`, by the generic evolve and the author's, the way a
 * rebuild folds them. A `history: 'state'` entity is answered from its transient change records
 * within the feed horizon (section 7.9.6). Kernel-internal: the generated `get` and `history` take
 * instants; a payload carrying a field that is `stateOnly` reads without it.
 */
export async function readAsOfPosition(input: AsOfInput): Promise<readonly StorageRow[]> {
  const { unit, entry, at } = input;
  if (entry.descriptor.history === 'state') return readStateAsOfPosition(input);
  if (entry.descriptor.history !== 'chain') {
    throw replayUnsupported(
      `${entry.ref} is a ${entry.descriptor.history} entity: it has no event chain to read as of a position.`,
    );
  }
  const rows = new Map<string, StorageRow>();
  let after: Position | null = null;
  for (;;) {
    const batch = await unit.events.readAll(after, {
      limit: pageSize,
      selector: { streamTypes: [entry.ref] },
    });
    const events = await openStoredEvents(unit, batch.events);
    for (const event of events) {
      if (event.position > at) return [...rows.values()];
      rows.set(
        event.stream.id,
        foldStoredEvent(entry, input.behaviours, rows.get(event.stream.id), event),
      );
    }
    if (batch.next === null || batch.events.length === 0) return [...rows.values()];
    after = batch.next;
  }
}
