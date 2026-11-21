import { waitForEmptyListing } from '@keelwerk/testing/postgres';
import { asAdmin } from './cell-database.ts';
import type { PostgresUrls } from './postgres-urls.ts';

/**
 * The grace a database's own connections have to be gone before its count is read: a hang bound, not
 * a speed. A failure rests only on a listing that started after it (`waitForEmptyListing`).
 */
const graceMs = 60_000;

/**
 * The transactions a database ended (committed or rolled back: a read-only unit rolls back), read once no connection of its own is open: a backend
 * hands its counts to `pg_stat_database` when it ends or goes idle, so a reading taken while one is
 * open can miss its last second. The reading connection is on the container's maintenance database,
 * so reading adds nothing to the count.
 */
export async function transactionsOf(container: PostgresUrls, database: string): Promise<number> {
  const open = await waitForEmptyListing(
    () =>
      asAdmin(
        container.adminUrl,
        async (client) =>
          (
            await client.query<{ pid: number }>(
              'select pid from pg_stat_activity where datname = $1',
              [database],
            )
          ).rows,
      ),
    { timeoutMs: graceMs },
  );
  if (open.length > 0) throw new Error(`${database} still has open connections`);
  return asAdmin(container.adminUrl, async (client) => {
    const commits = await client.query<{ commits: string }>(
      'select (xact_commit + xact_rollback)::text as commits from pg_stat_database where datname = $1',
      [database],
    );
    return Number(commits.rows[0]?.commits);
  });
}
