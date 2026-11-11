import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { foldStream } from './fold-stream.ts';

/** Memoises a lookup by key: the first call runs it, the others share its promise. */
function once<T>(run: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const found = new Map<string, Promise<T>>();
  return (key) => {
    const known = found.get(key);
    if (known !== undefined) return known;
    const started = run(key);
    found.set(key, started);
    return started;
  };
}

/** What a stream is now, for the check that its relation keys did not change since the position asked about. */
interface CurrentKeys {
  /** The stored row, or for a purged row (which has none) the whole stream folded; absent when neither exists. */
  readonly latest: StorageRow | undefined;
  readonly purged: boolean;
}

/** What `createEarlierImages` takes. */
export interface EarlierImagesInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly entry: EntityEntry;
  /** The position `p` of the state asked for. */
  readonly since: Position;
}

/**
 * The streams of one entity as they were at one position, rebuilt from their events at most once
 * each: every plan group that asks about the same stream shares the fold, the lookup of the current
 * row and the check whether a type had an event since. The plan's own condition is evaluated on these
 * rows by `readableBefore`, so the cost of a pass grows with the streams, not with groups times streams.
 */
export interface EarlierImages {
  /** The row of the stream after its last event at or before `since`; absent when the history cannot be rebuilt (purged records) or has no event by then. */
  at(id: string): Promise<StorageRow | undefined>;
  /** The stream's current state, for the relation-key check. */
  current(id: string): Promise<CurrentKeys>;
  /** Whether any of the types had an event after `since`. */
  moved(types: readonly string[]): Promise<boolean>;
}

/** The images of `entry`'s streams at `input.since`. */
export function createEarlierImages(input: EarlierImagesInput): EarlierImages {
  const { unit, registry, entry, since } = input;
  const at = once(async (id) => {
    const folded = await foldStream({
      unit,
      registry,
      entry,
      id,
      keep: (event) => event.position <= since,
    });
    return !folded.complete || folded.kept.length === 0 ? undefined : folded.row;
  });
  const current = once(async (id): Promise<CurrentKeys> => {
    const found = await unit.rows.find(entry.descriptor, {
      where: { op: 'eq', field: 'id', value: id },
      page: { first: 1 },
      includeArchived: true,
    });
    const [stored] = found.rows;
    if (stored !== undefined) return { latest: stored, purged: false };
    // A purged row has no current state: its last known keys are those of the whole stream folded.
    const folded = await foldStream({ unit, registry, entry, id, keep: () => true });
    return { latest: folded.row, purged: true };
  });
  const moved = once(async (types) => {
    const found = await unit.events.readAll(since, {
      limit: 1,
      selector: { streamTypes: types.split('\u0000') },
      includeTransient: true,
    });
    return found.events.length > 0;
  });
  return { at, current, moved: (types) => moved([...types].sort().join('\u0000')) };
}
