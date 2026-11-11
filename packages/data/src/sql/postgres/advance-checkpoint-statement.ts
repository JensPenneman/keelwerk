import type { Position } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Moves a consumer's checkpoint of one scope forward and never back (S-173, D6): the row is
 * inserted, or the stored position becomes the greater of itself and `to`, and `updated_at` changes
 * only when the position did. The conflict update locks the row until the unit ends and decides on
 * the latest committed version, so concurrent advances end at the greater position.
 */
export function advanceCheckpointStatement(
  rootName: string,
  consumer: string,
  scopeId: string,
  to: Position,
  updatedAt: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `insert into ${root}.kw_consumers as c (consumer_id, scope_id, position, updated_at)
values ($1::text, $2::uuid, $3::bigint, $4::timestamptz)
on conflict (consumer_id, scope_id) do update set
  position = greatest(c.position, excluded.position),
  updated_at = case when excluded.position > c.position then excluded.updated_at else c.updated_at end`,
    parameters: [consumer, scopeId, to.toString(), updatedAt],
  };
}
