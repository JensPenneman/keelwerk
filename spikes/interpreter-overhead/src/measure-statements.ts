import pg from 'pg';
import type { BenchCell } from './bench-cell.ts';
import { createDatabase } from './create-database.ts';
import { measureCell } from './measure-cell.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { startBenchWorld } from './start-bench-world.ts';
import type { StatementProfile } from './statement-profile.ts';

/**
 * Counts the statements of a cell with `pg_stat_statements`: a database of its own, the statistics
 * reset after the world is seeded, `commands` commands, then the statistics of that database. The
 * statements of the measurement query itself are left out.
 */
export async function measureStatements(
  container: PostgresUrls,
  cell: BenchCell,
  commands: number,
): Promise<StatementProfile> {
  const database = await createDatabase(container);
  try {
    const world = await startBenchWorld(database.urls);
    const admin = new pg.Client({ connectionString: database.urls.adminUrl });
    await admin.connect();
    try {
      await admin.query('select pg_stat_statements_reset()');
      await measureCell(world, cell, commands);
      const result = await admin.query<{ query: string; calls: string; total: number }>(
        `select query, calls::text, total_exec_time as total
         from pg_stat_statements
         where dbid = (select oid from pg_database where datname = $1)
           and query not like '%pg_stat_statements%'
         order by query`,
        [database.name],
      );
      return {
        cell,
        commands,
        statements: result.rows.map((row) => ({
          query: row.query.replace(/\s+/g, ' ').trim(),
          callsPerCommand: Number(row.calls) / commands,
          microsPerCall: (row.total * 1000) / Number(row.calls),
        })),
      };
    } finally {
      await admin.end();
      await world.stop();
    }
  } finally {
    await database.drop();
  }
}
