import { errors } from '@keelwerk/core';

/** Thrown at the end of a writing unit that met a key whose tombstone is not recorded: the unit rolls back. */
class Untombstoned extends Error {
  constructor() {
    super('A key about to be destroyed has no tombstone yet.');
    this.name = 'Untombstoned';
  }
}

/** What a writing unit that destroys keys is given to prove their tombstones are recorded. */
export interface KeyGate {
  /** Called with the ids of the keys about to be destroyed, before they are. */
  readonly onValueKeys: (keyIds: readonly string[]) => Promise<void>;
  /** Called last in the unit, before it commits: throws when `onValueKeys` met a key with no tombstone. */
  readonly check: () => void;
}

/**
 * Runs `pass`, whose writing unit destroys keys and ends with `gate.check()`. When the unit met
 * keys whose tombstone is not in `known`, it has rolled back; `record` appends the tombstones of
 * exactly those keys (ledger and sinks, outside any unit) and the pass runs again. Every repeat must
 * add a tombstone to `known`: one that adds none ends with `core.unavailable`, so the loop is
 * bounded and the worker tries the record again later.
 */
export async function untilTombstoned<T>(
  known: ReadonlySet<string>,
  record: (keyIds: readonly string[]) => Promise<void>,
  pass: (gate: KeyGate) => Promise<T>,
): Promise<T> {
  for (;;) {
    const missing = new Set<string>();
    try {
      return await pass({
        onValueKeys: (keyIds) => {
          for (const keyId of keyIds) if (!known.has(keyId)) missing.add(keyId);
          return Promise.resolve();
        },
        check: () => {
          if (missing.size > 0) throw new Untombstoned();
        },
      });
    } catch (error) {
      if (!(error instanceof Untombstoned)) throw error;
    }
    const before = known.size;
    await record([...missing]);
    if (known.size === before) {
      throw errors.unavailable('A repeat of the erasure recorded no new key tombstone.');
    }
  }
}
