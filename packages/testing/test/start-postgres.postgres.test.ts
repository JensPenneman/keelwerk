import pg from 'pg';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { declaredDeadlocks } from '../src/postgres/declared-deadlocks.ts';
import { declareDeadlocks, execInContainer, startPostgres } from '../src/postgres/index.ts';
import { provokeDeadlock } from './support/provoke-deadlock.ts';

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
  // This file tests the rule itself: what a case declares or starts must not carry over to the next.
  afterEach(() => {
    declaredDeadlocks.count = 0;
    declaredDeadlocks.checked = 0;
  });

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

  it(
    'a container stops when its deadlocks were declared, refuses to stop quietly when one was not, and stops when none moved the counter',
    async () => {
      const declared = await startPostgres();
      await provokeDeadlock(declared.adminUrl, 'declared');
      declareDeadlocks(1);
      await expect(declared.stop()).resolves.toBeUndefined();
      declaredDeadlocks.count = 0;

      const undeclared = await startPostgres();
      await provokeDeadlock(undeclared.adminUrl, 'undeclared');
      await expect(undeclared.stop()).rejects.toThrow(
        'moved the PostgreSQL deadlock counter by 1 and declared 0',
      );

      const quiet = await startPostgres();
      await expect(quiet.stop()).resolves.toBeUndefined();
    },
    3 * startTimeout,
  );

  it(
    'a container opted out with checkDeadlocks false stops although a deadlock moved its counter',
    async () => {
      const opted = await startPostgres({ checkDeadlocks: false });
      await provokeDeadlock(opted.adminUrl, 'opted');
      await expect(opted.stop()).resolves.toBeUndefined();
    },
    startTimeout,
  );

  it(
    'a file that declared deadlocks and stops two checked containers is refused, and the message says to opt one out or split the file',
    async () => {
      const first = await startPostgres();
      const second = await startPostgres();
      await provokeDeadlock(first.adminUrl, 'ambiguous');
      declareDeadlocks(1);
      await expect(first.stop()).rejects.toThrow('Opt one container out');
      await expect(second.stop()).resolves.toBeUndefined();
    },
    2 * startTimeout,
  );

  it(
    'runs a command in the container: the image carries pg_dump and pg_restore, and a failing one answers its exit code',
    async () => {
      const { containerId } = inject('postgresCluster');
      for (const tool of ['pg_dump', 'pg_restore']) {
        const answer = await execInContainer(containerId, [tool, '--version']);
        expect(answer.exitCode).toBe(0);
        expect(answer.output).toContain('(PostgreSQL) 18');
      }
      expect((await execInContainer(containerId, ['false'])).exitCode).not.toBe(0);
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
