import type { EventStore } from '../events/event-store.ts';
import type { StreamAppend } from '../events/stream-append.ts';
import type { SubjectKeyStore } from '../storage/subject-key-store.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The unit with its event store wrapped so every `append` batch is handed to `record` before it
 * is buffered, and its value keys through `keysOf` (the dry run keeps new ones in memory). Savepoints hand out wrapped units too, so what a nested command appends is seen.
 */
export function recordingUnit(
  unit: Unit,
  record: (batch: readonly StreamAppend[]) => void,
  keysOf: (inner: SubjectKeyStore) => SubjectKeyStore = (inner) => inner,
): Unit {
  const { events } = unit;
  const recording: EventStore = {
    append: (batch) => {
      record(batch);
      return events.append(batch);
    },
    readStream: (stream, range) => events.readStream(stream, range),
    readAll: (after, options) => events.readAll(after, options),
    find: (match, page) => events.find(match, page),
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
    keys: keysOf(unit.keys),
    serials: unit.serials,
    ...(unit.scopeKeys === undefined ? {} : { scopeKeys: unit.scopeKeys }),
    nested: (fn, options) =>
      unit.nested((inner) => fn(recordingUnit(inner, record, keysOf)), options),
    afterCommit: (fn) => {
      unit.afterCommit(fn);
    },
  };
}
