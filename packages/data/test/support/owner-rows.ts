import type { PgliteAdapter } from '../../src/pglite/index.ts';

/** The rows of a query run as the database owner, which row-level security does not restrict. */
export async function ownerRows(
  adapter: PgliteAdapter,
  sql: string,
): Promise<readonly Record<string, unknown>[]> {
  return adapter.asOwner(
    async (database) => (await database.query<Record<string, unknown>>(sql)).rows,
  );
}
