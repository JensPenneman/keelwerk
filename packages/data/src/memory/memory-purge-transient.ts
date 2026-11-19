import type { PurgeBatch } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkPurgeLimit } from '../sql/check-purge-limit.ts';
import { checkPurgeTypes } from '../sql/check-purge-types.ts';
import { commandReceiptTable } from '../sql/postgres/command-receipt-table.ts';
import type { MemoryLoggedEvent } from './memory-logged-event.ts';
import { memoryRowsName } from './memory-rows-name.ts';
import { memoryStreamKey } from './memory-stream-key.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * `EventStore.purgeTransient` over the scope's log: deletes the committed transient records
 * recorded before `before`, oldest first, at most `limit`, only of the listed stream types (an
 * empty list removes nothing), keeping the newest record of each stream (its version counter and
 * every selector's head stay where they were) and every record that carries a hash or a previous
 * hash, whatever its `transient` flag says. The one exception to the newest record: that of a
 * receipt stream whose receipt row is gone from the scope (the row id is the stream id). A list
 * that names a type outside `transientPurgeTypes` is refused with `validation`.
 * Answers how many it deleted and whether a candidate of a listed type is left.
 */
export function memoryPurgeTransient(
  ctx: MemoryUnitContext,
  before: Temporal.Instant,
  limit: number,
  streamTypes: readonly string[],
): PurgeBatch {
  ctx.writable();
  checkPurgeLimit(limit);
  checkPurgeTypes(streamTypes);
  if (ctx.scope.level === 'namespace') {
    throw errors.internal('a namespace-scope unit has no event log');
  }
  const listed = new Set(streamTypes);
  const scopeId = ctx.scopeId();
  const versions = ctx.tx.read<number>(`streamv/${scopeId}`);
  const receipts = ctx.tx.read<unknown>(memoryRowsName(commandReceiptTable, scopeId));
  const doomed: { readonly key: string; readonly event: MemoryLoggedEvent['event'] }[] = [];
  for (const [key, logged] of ctx.tx.read<MemoryLoggedEvent>(`events/${scopeId}`)) {
    const { event } = logged;
    if (!listed.has(event.stream.type)) continue;
    if (!event.transient || event.hash !== null || event.prevHash !== null) continue;
    if (Temporal.Instant.compare(event.recordedAt, before) >= 0) continue;
    const newest = versions.get(memoryStreamKey(event.stream.type, event.stream.id)) ?? 0;
    // The newest record stays, unless its receipt is gone: the stream serves no one then.
    if (event.version >= newest && receipts.has(event.stream.id)) continue;
    doomed.push({ key, event });
  }
  doomed.sort(
    (a, b) =>
      Temporal.Instant.compare(a.event.recordedAt, b.event.recordedAt) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const chosen = doomed.slice(0, limit);
  if (chosen.length === 0) return { removed: 0, more: false };
  const log = ctx.tx.write<MemoryLoggedEvent>(`events/${scopeId}`);
  for (const { key } of chosen) log.delete(key);
  // A stream whose last record went starts again at version 1, as on SQL, where the version is
  // read from the records.
  const remaining = new Set<string>();
  for (const logged of ctx.tx.read<MemoryLoggedEvent>(`events/${scopeId}`).values()) {
    remaining.add(memoryStreamKey(logged.event.stream.type, logged.event.stream.id));
  }
  const counters = ctx.tx.write<number>(`streamv/${scopeId}`);
  for (const { event } of chosen) {
    const key = memoryStreamKey(event.stream.type, event.stream.id);
    if (!remaining.has(key)) counters.delete(key);
  }
  return { removed: chosen.length, more: doomed.length > chosen.length };
}
