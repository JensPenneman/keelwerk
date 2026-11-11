import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The checkpoints a starting consumer begins with (15.2.3): one per scope that has events, at the
 * head the statement's one snapshot reads (`next - 1` of the scope's counter). Insert-if-absent, so
 * a checkpoint that exists is never moved.
 */
export function headCheckpointsStatement(
  rootName: string,
  consumer: string,
  startedAt: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `insert into ${root}.kw_consumers (consumer_id, scope_id, position, updated_at) select $1::text, p.scope_id, p.next - 1, $2::timestamptz from ${root}.kw_positions p where p.next > 1 on conflict (consumer_id, scope_id) do nothing`,
    parameters: [consumer, startedAt],
  };
}
