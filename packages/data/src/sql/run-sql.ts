import type { Kysely } from 'kysely';
import { CompiledQuery } from 'kysely';
import type { PostgresStatement } from './postgres/begin-unit-statements.ts';
import type { SqlDb } from './sql-db.ts';

/** A row as the driver returns it: column names to values. */
export type SqlRow = Readonly<Record<string, unknown>>;

/** Runs a statement of text and parameters on the unit's transaction and returns its rows. */
export async function runSql(
  db: Kysely<SqlDb>,
  statement: PostgresStatement,
): Promise<readonly SqlRow[]> {
  const result = await db.executeQuery<SqlRow>(
    CompiledQuery.raw(statement.sql, [...statement.parameters]),
  );
  return result.rows;
}
