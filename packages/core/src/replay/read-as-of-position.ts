import { errors } from '../errors/errors.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { applyDomainEvolve } from '../write-path/apply-domain-evolve.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import type { EvolvingEvent } from '../write-path/evolving-event.ts';
import { genericEvolve } from '../write-path/generic-evolve.ts';
import { replayUnsupported } from './replay-unsupported.ts';

const generatedEvents = new Set(['created', 'imported', 'changed', 'archived', 'restored']);
const pageSize = 500;

/** What an as-of read takes. */
export interface AsOfInput {
  /** A unit of the scope the entity lives in. */
  readonly unit: Unit;
  readonly entry: EntityEntry;
  readonly behaviours: EntityBehaviours;
  /** The last committed position of the scope the read sees (S-19, S-25). */
  readonly at: Position;
}

/**
 * Every row of a chain entity as it was at a position of its scope (S-25): the streams folded
 * from their events up to and including `at`, by the generic evolve and the author's, the way a
 * rebuild folds them. Kernel-internal: the generated `get` and `history` take instants. Loads of
 * a `history: 'state'` entity cannot be answered this way, their events are transient records
 * (section 7.9.6), and a payload carrying a field that is `stateOnly` reads without it.
 */
export async function readAsOfPosition(input: AsOfInput): Promise<readonly StorageRow[]> {
  const { unit, entry, at } = input;
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
    for (const event of batch.events) {
      if (event.position > at) return [...rows.values()];
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
      const state = rows.get(id);
      if (generatedEvents.has(name)) {
        rows.set(id, genericEvolve(entry, state, evolving));
      } else if (state === undefined) {
        throw errors.internal(`the stream ${entry.ref}/${id} starts with "${name}"`);
      } else {
        rows.set(
          id,
          applyDomainEvolve(entry, input.behaviours(entry.ref), state, evolving, event.data),
        );
      }
    }
    if (batch.next === null || batch.events.length === 0) return [...rows.values()];
    after = batch.next;
  }
}
