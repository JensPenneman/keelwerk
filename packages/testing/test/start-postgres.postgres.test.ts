import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { startPostgres } from '../src/postgres/index.ts';

async function query<Row extends pg.QueryResultRow>(
  connectionString: string,
  text: string,
): Promise<readonly Row[]> {
  const client = new pg.Client({ connectionString });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return (await client.query<Row>(text)).rows;
  } finally {
    await client.end();
  }
}

// A cold image pull can exceed the project's default timeout; WP-65 pre-pulls in CI.
const startTimeout = 180_000;

// The project's global setup already runs one container; each case here adds at most one more, and
// stops it before it ends, so two containers are the most that ever run (plan rule 4).
describe('startPostgres', () => {
  it(
    'starts PostgreSQL 18 with a non-privileged application role',
    async () => {
      const postgres = await startPostgres();
      try {
        expect(postgres.version).toContain('PostgreSQL 18');

        expect(await query(postgres.appUrl, 'select 1 as one')).toEqual([{ one: 1 }]);
        expect(
          await query(
            postgres.appUrl,
            `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
          ),
        ).toEqual([{ rolsuper: false, rolbypassrls: false }]);
        expect(
          await query(postgres.adminUrl, `select current_setting('max_connections') as setting`),
        ).toEqual([{ setting: '200' }]);
      } finally {
        await postgres.stop();
      }
    },
    startTimeout,
  );

  it(
    'gives a start a container of its own, apart from the one the project shares',
    async () => {
      const shared = inject('postgresCluster');
      const own = await startPostgres();
      try {
        expect(own.adminUrl).not.toBe(shared.adminUrl);

        await query(own.adminUrl, 'create table marker (id int)');
        expect(await query(shared.adminUrl, `select to_regclass('marker') as found`)).toEqual([
          { found: null },
        ]);
      } finally {
        await own.stop();
      }
    },
    startTimeout,
  );

  it('mounts the volume path that holds the data directory as tmpfs', async () => {
    const shared = inject('postgresCluster');
    const mounts = await query<{ mounts: string }>(
      shared.adminUrl,
      `select pg_read_file('/proc/mounts') as mounts`,
    );
    const line = (mounts[0]?.mounts ?? '')
      .split('\n')
      .find((entry) => entry.split(' ')[1] === '/var/lib/postgresql');
    expect(line?.split(' ')[2]).toBe('tmpfs');
  });
});
