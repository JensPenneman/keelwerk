import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { MeasuredPostgres } from './measured-postgres.ts';

const image = 'postgres:18.6-alpine';

/**
 * Starts the one PostgreSQL 18 container of the measurement like `startPostgres` of
 * `@keelwerk/testing/postgres` (image defaults for durability, `max_connections` 200, data
 * directory on tmpfs, label `keelwerk-test`, an application role without BYPASSRLS) and loads
 * `pg_stat_statements`, which that helper does not.
 */
export async function startMeasuredPostgres(): Promise<MeasuredPostgres> {
  const container = await new PostgreSqlContainer(image)
    .withCommand([
      'postgres',
      '-c',
      'max_connections=200',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
    ])
    .withLabels({ 'keelwerk-test': 'postgres' })
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    .start();
  try {
    const adminUrl = container.getConnectionUri();
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(`create role kw_app login password 'kw_app' nosuperuser nobypassrls`);
      const version = await client.query<{ version: string }>('select version()');
      return {
        adminUrl,
        appUrl: adminUrl.replace(
          `${container.getUsername()}:${container.getPassword()}@`,
          'kw_app:kw_app@',
        ),
        version: version.rows[0]?.version ?? 'unknown',
        stop: async () => {
          await container.stop();
        },
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    await container.stop();
    throw error;
  }
}
