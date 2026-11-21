import type { DataAdapter, NamespaceRef, Registry, Scope, StoredEvent } from '@keelwerk/core';
import { storedEventBytesOf, storedStreamRecordBytes } from '@keelwerk/core';

/** Every record a scope stores, read back, with what `core.eventBytes` says and what they add up to. */
export interface StoredRecords {
  /** The scope's counter. */
  readonly counted: bigint;
  /** The scope's counter of `core.rows`. */
  readonly rows: bigint;
  /** The sum of `storedEventBytes` and `storedStreamRecordBytes` over the records read back. */
  readonly stored: bigint;
  readonly events: readonly StoredEvent[];
  /** The records of every declared stream, by stream, as stored. */
  readonly streams: ReadonlyMap<string, readonly unknown[]>;
}

/**
 * Reads the events of a scope (transient ones too) and the records of every declared stream, by
 * the ids of the entity each stream reads as, below the sealing layer, so the caller can compare the
 * counter with the same measure recomputed from what is stored. A record the framework stores and
 * the counter misses makes the two differ.
 */
export async function storedRecords(
  adapter: DataAdapter,
  namespace: NamespaceRef,
  scope: Scope,
  registry: Registry,
): Promise<StoredRecords> {
  return adapter.unit(
    namespace,
    scope,
    async (unit) => {
      const events: StoredEvent[] = [];
      let after = null;
      // `next` is the last position read; the log ends with the first empty page.
      for (;;) {
        const page = await unit.events.readAll(after, { limit: 500, includeTransient: true });
        if (page.events.length === 0) break;
        events.push(...page.events);
        after = page.next;
      }
      const streams = new Map<string, readonly unknown[]>();
      for (const entry of registry.streams.values()) {
        const owner = registry.entities.get(entry.readAs);
        if (owner === undefined) continue;
        const records: unknown[] = [];
        for (const row of (await unit.rows.find(owner.descriptor, {})).rows) {
          const read = await unit.streams.read(entry.ref, String(row.id), null, 1000);
          records.push(...read.map((record) => record.data));
        }
        streams.set(entry.ref, records);
      }
      let stored = 0n;
      for (const event of events) stored += storedEventBytesOf(event);
      for (const [stream, records] of streams) stored += storedStreamRecordBytes(stream, records);
      return {
        counted: await unit.usage.get('core.eventBytes'),
        rows: await unit.usage.get('core.rows'),
        stored,
        events,
        streams,
      };
    },
    { readOnly: true },
  );
}
