import { consumerStartScopeId } from '../consumer-start-scope-id.ts';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Records that a consumer has started (15.2.3): a `kw_consumers` row at the reserved scope id,
 * position 0, never advanced. Insert-if-absent: it answers a row only when this statement wrote it,
 * and a concurrent start waits for the first one's uncommitted row, then writes nothing.
 */
export function consumerStartStatement(
  rootName: string,
  consumer: string,
  startedAt: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `insert into ${root}.kw_consumers (consumer_id, scope_id, position, updated_at) values ($1::text, $2::uuid, 0, $3::timestamptz) on conflict (consumer_id, scope_id) do nothing returning consumer_id`,
    parameters: [consumer, consumerStartScopeId, startedAt],
  };
}
