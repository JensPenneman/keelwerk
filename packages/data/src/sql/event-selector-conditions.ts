import type { EventSelector } from '@keelwerk/core';
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import { sql } from 'kysely';
import type { SqlDb } from './sql-db.ts';

/**
 * The conditions of a selector on `kw_events` (15.1.11), all of which must hold: stream types, the
 * partition, event names (local, `changed`, or full, `app.note.changed`) and streams. An empty list
 * matches nothing.
 */
export function eventSelectorConditions(
  eb: ExpressionBuilder<SqlDb, string>,
  selector: EventSelector | undefined,
): readonly Expression<SqlBool>[] {
  if (selector === undefined) return [];
  const none = sql<SqlBool>`false`;
  const conditions: Expression<SqlBool>[] = [];
  if (selector.streamTypes !== undefined) {
    conditions.push(
      selector.streamTypes.length === 0 ? none : eb('stream_type', 'in', selector.streamTypes),
    );
  }
  if (selector.partition !== undefined) {
    conditions.push(eb('partition_key', '=', selector.partition));
  }
  if (selector.names !== undefined) {
    conditions.push(
      selector.names.length === 0
        ? none
        : eb.or([
            eb('name', 'in', selector.names),
            eb(sql<string>`stream_type || '.' || name`, 'in', selector.names),
          ]),
    );
  }
  if (selector.streams !== undefined) {
    conditions.push(
      selector.streams.length === 0
        ? none
        : eb.or(
            selector.streams.map((stream) =>
              eb.and([eb('stream_type', '=', stream.type), eb('stream_id', '=', stream.id)]),
            ),
          ),
    );
  }
  return conditions;
}
