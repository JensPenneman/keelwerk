import { errors } from '@keelwerk/core';
import { encodeEventMeta } from './encode-event-meta.ts';
import { encodeInstant } from './encode-instant.ts';
import type { CommitTailEvent } from './postgres/commit-tail-event.ts';
import type { SqlPendingEvent } from './sql-pending-event.ts';

/** The shape id as hex for `decode(..., 'hex')`; anything else is a kernel bug. */
function shapeHexOf(shape: string): string {
  if (!/^[0-9a-f]{64}$/.test(shape)) {
    throw errors.internal('the shape id of an event is not a lowercase hexadecimal SHA-256 hash');
  }
  return shape;
}

/**
 * A buffered event as the commit tail writes it (15.1.2): the shape id as the bytes the kernel's
 * hexadecimal shape hash spells (the table's column is `bytea`; the envelope's is hex text), `data` and
 * `before` as JSON, the invocation's members in `meta`, the recorded time at the columns'
 * millisecond precision.
 */
export function pendingTailEvent(pending: SqlPendingEvent): CommitTailEvent {
  const { event, stream } = pending;
  return {
    streamType: stream.type,
    streamId: stream.id,
    streamVersion: pending.version,
    partition: pending.partition,
    eventId: event.eventId,
    name: event.name,
    schemaVersion: event.schemaVersion,
    shapeHex: shapeHexOf(event.shape),
    data: JSON.stringify(event.data ?? null),
    before: event.before === null ? null : JSON.stringify(event.before),
    meta: encodeEventMeta(event.meta),
    hlc: event.hlc,
    recordedAt: encodeInstant(event.recordedAt),
    transient: event.transient,
    prevHash: event.prevHash,
    hash: event.hash,
  };
}
