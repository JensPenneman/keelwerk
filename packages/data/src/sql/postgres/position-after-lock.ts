import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The statement that reads a scope's position after a locked load (decision 109): the last
 * committed position, `next - 1` of the counter row, 0 for a scope that never appended. It must be
 * the first statement the unit sends after the lock is held. A subselect in the locking statement
 * keeps that statement's snapshot across a lock wait and records a position older than the row it
 * returns (100 of 100 commits on a hot row in the write-path spike), so the locking query never
 * carries it. The statement reads the counter row by `scope_id` and returns `position` as text.
 */
export function positionAfterLock(root: string, scopeId: string): PostgresStatement {
  return {
    sql: `select coalesce((select next - 1 from ${quoteIdentifier(root)}.kw_positions where scope_id = $1::uuid), 0)::text as position`,
    parameters: [scopeId],
  };
}
