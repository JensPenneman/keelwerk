import { CompiledQuery } from 'kysely';
import type { PostgresUnitSession } from '../../src/postgres-unit-session.ts';

/** Runs one statement in a unit's transaction and returns its rows. */
export async function query(
  session: PostgresUnitSession,
  text: string,
  parameters: readonly unknown[] = [],
): Promise<readonly Record<string, unknown>[]> {
  const result = await session.db.executeQuery<Record<string, unknown>>(
    CompiledQuery.raw(text, [...parameters]),
  );
  return result.rows;
}
