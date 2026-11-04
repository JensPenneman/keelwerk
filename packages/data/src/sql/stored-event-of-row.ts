import type { Hlc, Scope, StoredEvent } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { decodeEventMeta } from './decode-event-meta.ts';
import { decodeInstant } from './decode-instant.ts';
import type { SqlRow } from './run-sql.ts';
import { decodeBytes } from './sql-bytes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

function parsed(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function hex(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : Buffer.from(decodeBytes(value)).toString('hex');
}

function scopeOf(ctx: SqlUnitContext, row: SqlRow): Scope {
  switch (ctx.scope.level) {
    case 'tenant':
      return {
        level: 'tenant',
        backendId: String(row.backend_id),
        tenantId: String(row.scope_id),
      };
    case 'backend':
      return { level: 'backend', backendId: String(row.scope_id) };
    case 'deployment':
      return { level: 'deployment' };
    case 'namespace':
      throw errors.internal('a namespace-scope unit has no event log');
  }
}

/** One `kw_events` row (with the position selected as text, `position_text`: an output column named `position` would shadow the column in `order by` and sort the events as text) as the stored envelope of section 15.1.3. */
export function storedEventOfRow(
  ctx: SqlUnitContext,
  row: SqlRow,
  position: bigint = BigInt(String(row.position_text)),
): StoredEvent {
  const meta = decodeEventMeta(row.meta);
  const stream = { type: String(row.stream_type), id: String(row.stream_id) };
  return {
    eventId: String(row.event_id),
    position,
    namespace: ctx.namespace.id,
    scope: scopeOf(ctx, row),
    stream,
    version: Number(row.stream_version),
    partition: row.partition_key === null ? null : String(row.partition_key),
    type: `${stream.type}.${String(row.name)}`,
    shape: Buffer.from(decodeBytes(row.shape_id)).toString('hex'),
    data: parsed(row.data),
    before: row.before === null ? null : (parsed(row.before) as StoredEvent['before']),
    hlc: String(row.hlc) as Hlc,
    recordedAt: decodeInstant(row.recorded_at),
    actor: meta.actor,
    commandId: meta.commandId,
    action: meta.action,
    causationId: meta.causationId,
    correlationId: meta.correlationId,
    client: meta.client,
    merge: meta.merge,
    writer: meta.writer,
    flags: meta.flags,
    decision: meta.decision,
    transient: row.transient === true,
    prevHash: hex(row.prev_hash),
    hash: hex(row.hash),
    traceparent: meta.traceparent,
  };
}
