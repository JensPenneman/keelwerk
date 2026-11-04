import type { MemoryCollection } from './memory-collection.ts';

interface Owned {
  readonly map: Map<string, unknown>;
  /** The savepoint generation the copy was made in; a later generation copies again. */
  readonly generation: number;
}

/** The copy-on-write view one unit has of a namespace's collections. */
export interface MemoryTransaction {
  /** The collection as this unit sees it; empty when it does not exist. */
  read<V>(name: string): ReadonlyMap<string, V>;
  /** The unit's own copy of the collection, created on the first write after a savepoint. */
  write<V>(name: string): Map<string, V>;
  /** The names of every collection with the prefix, committed or written by this unit. */
  names(prefix: string): readonly string[];
  /** Starts a savepoint; the returned function rolls the unit back to it. */
  savepoint(): () => void;
  /** The collections this unit wrote, for the commit; names starting with `~` stay in the unit. */
  changes(): ReadonlyMap<string, MemoryCollection>;
}

/**
 * Copy-on-write maps behind a savepoint counter: a savepoint is a shallow copy of the table of
 * owned collections, and the first write after it copies the collection again, so a rollback
 * restores the earlier maps untouched. Committed maps are never mutated, which makes the base
 * itself a snapshot.
 */
export function memoryTransaction(base: ReadonlyMap<string, MemoryCollection>): MemoryTransaction {
  let owned = new Map<string, Owned>();
  let generation = 0;
  const empty: ReadonlyMap<string, unknown> = new Map();
  return {
    read: <V>(name: string) =>
      (owned.get(name)?.map ?? base.get(name) ?? empty) as ReadonlyMap<string, V>,
    write: <V>(name: string) => {
      const current = owned.get(name);
      if (current !== undefined && current.generation === generation) {
        return current.map as Map<string, V>;
      }
      const copy = new Map<string, unknown>(current?.map ?? base.get(name) ?? []);
      owned.set(name, { map: copy, generation });
      return copy as Map<string, V>;
    },
    names: (prefix) => {
      const found = new Set<string>();
      for (const name of base.keys()) if (name.startsWith(prefix)) found.add(name);
      for (const name of owned.keys()) if (name.startsWith(prefix)) found.add(name);
      return [...found];
    },
    savepoint: () => {
      const saved = new Map(owned);
      generation += 1;
      return () => {
        owned = saved;
        generation += 1;
      };
    },
    changes: () => {
      const changed = new Map<string, MemoryCollection>();
      for (const [name, entry] of owned) if (!name.startsWith('~')) changed.set(name, entry.map);
      return changed;
    },
  };
}
