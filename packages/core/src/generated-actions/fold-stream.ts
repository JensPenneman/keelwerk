import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { applyDomainEvolve } from '../write-path/apply-domain-evolve.ts';
import type { EvolvingEvent } from '../write-path/evolving-event.ts';
import { genericEvolve } from '../write-path/generic-evolve.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';

const generatedEvents: ReadonlySet<string> = new Set([
  'created',
  'imported',
  'changed',
  'archived',
  'restored',
]);

/** A stream folded up to a point. */
export interface FoldedStream {
  /** The row after the last kept event; absent when no event is kept. */
  readonly row: StorageRow | undefined;
  /** The events that were kept. */
  readonly kept: readonly StoredEvent[];
  /** False when the stream does not start at version 1 (purged records): the row cannot be rebuilt. */
  readonly complete: boolean;
}

/** What folding a stream takes. */
export interface FoldStreamInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly entry: EntityEntry;
  readonly id: string;
  /** Events are kept while this holds; the first that fails ends the fold (events are in version order). */
  readonly keep: (event: StoredEvent) => boolean;
}

/**
 * The row of one stream as it was after the last event `keep` accepts: the events folded by the
 * generic evolve and the author's, the way a rebuild folds them (section 15.1.5). A payload with
 * a `stateOnly` field reads without it.
 */
export async function foldStream(input: FoldStreamInput): Promise<FoldedStream> {
  const { entry } = input;
  const events = await input.unit.events.readStream({ type: entry.ref, id: input.id });
  const behaviours = registryBehaviours(input.registry);
  const kept: StoredEvent[] = [];
  let row: StorageRow | undefined;
  for (const event of events) {
    if (!input.keep(event)) break;
    kept.push(event);
    const name = event.type.slice(entry.ref.length + 1);
    const evolving: EvolvingEvent = {
      id: input.id,
      name,
      data: event.data,
      recordedAt: event.recordedAt,
      hlc: event.hlc,
      hash: event.hash,
    };
    if (generatedEvents.has(name)) {
      row = genericEvolve(entry, row, evolving);
    } else if (row === undefined) {
      throw errors.internal(`the stream ${entry.ref}/${input.id} starts with "${name}"`);
    } else {
      row = applyDomainEvolve(entry, behaviours(entry.ref), row, evolving, event.data);
    }
  }
  const [first] = events;
  return { row, kept, complete: first === undefined || first.version === 1 };
}
