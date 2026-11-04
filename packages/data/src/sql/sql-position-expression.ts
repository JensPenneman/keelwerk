import type { Expression } from 'kysely';
import { expressionBuilder, sql } from 'kysely';
import type { SqlDb } from './sql-db.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The scope's position as a scalar expression (S-19): `next - 1` of its counter row, the last
 * committed position, 0 for a scope that never appended. It is read in the same statement as the
 * rows, and the scoping plugin scopes the counter table with the rest of the statement.
 */
export function sqlPositionExpression(ctx: SqlUnitContext): Expression<unknown> {
  const counter = expressionBuilder<SqlDb, never>()
    .selectFrom(`${ctx.table('kw_positions')} as k`)
    .select(sql<string>`k.next - 1`.as('position'));
  return sql`coalesce(${counter}, 0)`;
}
