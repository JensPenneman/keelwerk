import type { Position, StoredEvent } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { MemoryPendingEvent } from './memory-pending-event.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The stored form of a buffered event (15.1.3) at a position. The position is the one the commit
 * tail will assign: the unit holds its namespace's lock, so no other commit lands in between.
 */
export function memoryEnvelope(
  ctx: MemoryUnitContext,
  pending: MemoryPendingEvent,
  position: Position,
): StoredEvent {
  const { event, stream } = pending;
  const scope = ctx.scope;
  if (scope.level === 'namespace') {
    throw errors.internal('a namespace-scope unit has no event log');
  }
  return {
    eventId: event.eventId,
    position,
    namespace: ctx.namespace.id,
    scope,
    stream,
    version: pending.version,
    partition: pending.partition,
    type: `${stream.type}.${event.name}`,
    schemaVersion: event.schemaVersion,
    shape: event.shape,
    data: event.data,
    before: event.before as StoredEvent['before'],
    hlc: event.hlc,
    recordedAt: event.recordedAt,
    actor: event.meta.actor,
    commandId: event.meta.commandId,
    action: event.meta.action,
    causationId: event.meta.causationId,
    correlationId: event.meta.correlationId,
    client: event.meta.client,
    merge: event.meta.merge,
    writer: event.meta.writer,
    flags: event.meta.flags,
    decision: event.meta.decision,
    transient: event.transient,
    prevHash: event.prevHash,
    hash: event.hash,
    traceparent: event.meta.traceparent,
  };
}
