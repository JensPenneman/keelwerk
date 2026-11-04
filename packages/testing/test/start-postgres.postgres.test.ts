import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
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

describe('startPostgres', () => {
  const started: Awaited<ReturnType<typeof startPostgres>>[] = [];
  afterAll(async () => {
    await Promise.all(started.map((postgres) => postgres.stop()));
  });

  it(
    'starts PostgreSQL 18 with a non-privileged application role',
    async () => {
      const postgres = await startPostgres();
      started.push(postgres);
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
    },
    startTimeout,
  );

  it(
    'gives a second start a fresh container',
    async () => {
      const first = await startPostgres();
      started.push(first);
      const second = await startPostgres();
      started.push(second);
      expect(second.adminUrl).not.toBe(first.adminUrl);

      await query(first.adminUrl, 'create table marker (id int)');
      expect(await query(second.adminUrl, `select to_regclass('marker') as found`)).toEqual([
        { found: null },
      ]);
    },
    startTimeout,
  );
});
