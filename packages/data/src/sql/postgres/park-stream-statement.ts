import type { ErrorKind, Position, StreamRef } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Parks a stream of a consumer in one scope (15.2.3): inserted with one parking, or, while its row
 * exists, one parking more with the earliest position kept. The stored error changes only for a
 * parking at or before the stored position (a failed replay); `parked_at` is kept. Of the error only
 * its kind and code are stored, as JSON.
 */
export function parkStreamStatement(
  rootName: string,
  consumer: string,
  scopeId: string,
  stream: StreamRef,
  from: Position,
  error: { readonly kind: ErrorKind; readonly code: string },
  parkedAt: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `insert into ${root}.kw_parked as p
  (consumer_id, scope_id, stream_type, stream_id, from_position, attempts, last_error, parked_at)
values ($1::text, $2::uuid, $3::text, $4::uuid, $5::bigint, 1, $6::jsonb, $7::timestamptz)
on conflict (consumer_id, scope_id, stream_type, stream_id) do update set
  from_position = least(p.from_position, excluded.from_position),
  attempts = p.attempts + 1,
  last_error = case when excluded.from_position <= p.from_position then excluded.last_error else p.last_error end`,
    parameters: [
      consumer,
      scopeId,
      stream.type,
      stream.id,
      from.toString(),
      JSON.stringify({ kind: error.kind, code: error.code }),
      parkedAt,
    ],
  };
}
