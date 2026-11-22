import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { deadlockCount, execInContainer, startPostgres } from '../src/postgres/index.ts';
import { provokeDeadlock } from './support/provoke-deadlock.ts';

async function query<Row extends pg.QueryResultRow>(
  connectionString: string,
  text: string,
): Promise<readonly Row[]> {
  const client = new pg.Client({ connectionString });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.query<Row>(text)).rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// A cold image pull can exceed the project's default timeout; WP-65 pre-pulls in CI.
const startTimeout = 180_000;

describe('startPostgres with restartable: true', () => {
  it(
    'stops and starts the server again on the same data and the same port',
    async () => {
      const postgres = await startPostgres({ restartable: true });
      try {
        await query(postgres.adminUrl, 'create table kept (n int)');
        await query(postgres.adminUrl, 'insert into kept values (7)');
        await postgres.stopServer();
        // The container is still there and its port still forwarded, but nothing answers.
        await expect(query(postgres.adminUrl, 'select 1')).rejects.toThrow();
        await postgres.startServer();
        expect(await query(postgres.adminUrl, 'select n from kept')).toEqual([{ n: 7 }]);
        expect(await query(postgres.appUrl, 'select 1 as one')).toEqual([{ one: 1 }]);
      } finally {
        await postgres.stop();
      }
    },
    startTimeout,
  );

  it(
    'restarts the server twice, and the container still stops with the server running',
    async () => {
      const postgres = await startPostgres({ restartable: true });
      try {
        for (let round = 0; round < 2; round += 1) {
          await postgres.stopServer();
          await postgres.startServer();
        }
        expect(await query(postgres.adminUrl, 'select 1 as one')).toEqual([{ one: 1 }]);
      } finally {
        await postgres.stop();
      }
    },
    startTimeout,
  );

  it(
    'rejects at startServer when the restart reset the deadlock counter, so a reset never passes unseen',
    async () => {
      // The file's rule is the thing under test: this container is not checked at its stop.
      const postgres = await startPostgres({ restartable: true, checkDeadlocks: false });
      try {
        const cluster = { containerId: postgres.containerId, adminUrl: postgres.adminUrl };
        await provokeDeadlock(postgres.adminUrl, 'before-restart');
        expect(await deadlockCount(cluster)).toBe(1);
        await postgres.stopServer();
        // Without the statistics file the fast shutdown wrote, the server starts with its counters
        // at zero.
        const removed = await execInContainer(
          postgres.containerId,
          ['sh', '-c', 'rm -f "$PGDATA/pg_stat/pgstat.stat"'],
          { user: 'postgres' },
        );
        expect(removed.exitCode).toBe(0);
        await expect(postgres.startServer()).rejects.toThrow(/fell from 1 to 0/);
      } finally {
        await postgres.stop();
      }
    },
    startTimeout,
  );

  it(
    'shuts the server down and ends itself when its first process is told to stop, as docker stop does',
    async () => {
      const postgres = await startPostgres({ restartable: true, checkDeadlocks: false });
      const docker = (...args: string[]) => promisify(execFile)('docker', args);
      try {
        const told = await execInContainer(postgres.containerId, ['kill', '-TERM', '1']);
        expect(told.exitCode).toBe(0);
        // The container ends by itself, well before docker would kill it after its grace period.
        const deadline = Date.now() + 60_000;
        for (;;) {
          const looked = Date.now();
          const { stdout } = await docker(
            'inspect',
            '--format',
            '{{.State.Running}} {{.State.ExitCode}}',
            postgres.containerId,
          );
          if (stdout.trim().startsWith('false')) {
            expect(stdout.trim()).toBe('false 0');
            break;
          }
          if (looked > deadline) throw new Error('the container did not end after TERM');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } finally {
        await docker('rm', '--force', '--volumes', postgres.containerId);
      }
    },
    startTimeout,
  );
});
