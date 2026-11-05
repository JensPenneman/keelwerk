import type { EventStore } from '../events/event-store.ts';
import type { StreamAppend } from '../events/stream-append.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The unit with its event store wrapped so every `append` batch is handed to `record` before it
 * is buffered. Savepoints hand out wrapped units too, so what a nested command appends is seen.
 */
export function recordingUnit(unit: Unit, record: (batch: readonly StreamAppend[]) => void): Unit {
  const { events } = unit;
  const recording: EventStore = {
    append: (batch) => {
      record(batch);
      return events.append(batch);
    },
    readStream: (stream, range) => events.readStream(stream, range),
    readAll: (after, options) => events.readAll(after, options),
    head: (selector) => events.head(selector),
    committed: () => events.committed(),
    movedScopes: (since, limit) => events.movedScopes(since, limit),
  };
  return {
    namespace: unit.namespace,
    scope: unit.scope,
    readOnly: unit.readOnly,
    rows: unit.rows,
    events: recording,
    receipts: unit.receipts,
    jobs: unit.jobs,
    usage: unit.usage,
    buckets: unit.buckets,
    keys: unit.keys,
    serials: unit.serials,
    ...(unit.scopeKeys === undefined ? {} : { scopeKeys: unit.scopeKeys }),
    nested: (fn, options) => unit.nested((inner) => fn(recordingUnit(inner, record)), options),
    afterCommit: (fn) => {
      unit.afterCommit(fn);
    },
  };
}
