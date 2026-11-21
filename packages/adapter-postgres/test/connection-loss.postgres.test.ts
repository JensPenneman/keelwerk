import { isKeelwerkError } from '@keelwerk/core';
import type { LoggedLine } from '@keelwerk/testing';
import { recordingLogger } from '@keelwerk/testing';
import { keepIdleClients } from '@keelwerk/testing/postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPostgresInstance } from '../src/create-postgres-instance.ts';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import { query } from './support/query.ts';
import type { TestDatabase } from './support/test-database.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA } = testScopes;

let running: TestDatabase;
let owner: pg.Client;
let instance: PostgresAdapterInstance;
const ownerErrors: Error[] = [];
const lines: LoggedLine[] = [];
let warned: Promise<void> = Promise.resolve();
let onWarn: (message: string) => void = () => undefined;

function expectWarn(prefix: string): void {
  warned = new Promise<void>((resolve) => {
    onWarn = (message) => {
      if (message.startsWith(prefix)) resolve();
    };
  });
}

function environment() {
  const base = testEnvironment();
  const recorder = recordingLogger(lines);
  return {
    ...base,
    log: {
      ...recorder,
      warn: (message: string, fields?: Readonly<Record<string, unknown>>) => {
        recorder.warn(message, fields);
        onWarn(message);
      },
    },
  };
}

async function terminate(applicationName: string): Promise<void> {
  await owner.query(
    'select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1',
    [applicationName],
  );
}

beforeAll(async () => {
  running = await createTestDatabase('connection_loss');
  await prepareNamespaces(running.adminUrl);
  owner = new pg.Client({ connectionString: running.adminUrl });
  owner.on('error', (error) => ownerErrors.push(error));
  await owner.connect();
  instance = createPostgresInstance(
    { applicationName: 'loss' },
    {
      id: 'main',
      url: running.appUrl,
      strategy: 'shared-tables',
      pool: { max: 1, ...keepIdleClients },
    },
    environment(),
  );
  await instance.connect();
});

afterAll(async () => {
  await instance?.close(5000);
  expect(ownerErrors).toEqual([]);
  await owner?.end();
});

describe('a connection the server ends', () => {
  test('an idle connection the server ends is logged once without the connection string, and the next unit commits', async () => {
    await instance.session(testNamespace, scopeA, (s) => query(s, 'select 1'));
    lines.length = 0;
    expectWarn('postgres pool:');
    await terminate('loss');
    await warned;
    const rows = await instance.session(testNamespace, scopeA, (s) => query(s, 'select 1 as one'));
    expect(rows).toEqual([{ one: 1 }]);
    const warnings = lines.filter((line) => line.level === 'warn');
    expect(warnings).toHaveLength(1);
    const text = JSON.stringify(lines);
    expect(text).not.toContain(running.appUrl);
    expect(text).not.toContain('kw_app:');
    expect(text).not.toContain('postgres://');
  });

  test('a connection in use between two statements that the server ends fails its unit with core.unavailable, and the next unit commits', async () => {
    const failure = await instance
      .session(testNamespace, scopeA, async (s) => {
        await query(s, 'select 1');
        expectWarn('postgres pool:');
        await terminate('loss');
        await warned;
        await query(s, 'select 2');
      })
      .catch((error: unknown) => error);
    expect(isKeelwerkError(failure)).toBe(true);
    expect(failure).toMatchObject({ code: 'core.unavailable' });
    const rows = await instance.session(testNamespace, scopeA, (s) =>
      query(s, 'select 3 as three'),
    );
    expect(rows).toEqual([{ three: 3 }]);
  });

  test('a statement running when the server ends its connection fails its unit with core.unavailable, and the next unit commits', async () => {
    const failure = await instance
      .session(testNamespace, scopeA, async (s) => {
        const pid = Number((await query(s, 'select pg_backend_pid() as pid'))[0]?.pid);
        const sleeping = query(s, 'select pg_sleep(30)');
        // The sleep is not awaited yet: the owner ends the backend once the server shows it asleep.
        const ended = (async () => {
          while (true) {
            const alive = await owner.query('select 1 from pg_stat_activity where pid = $1', [pid]);
            if (alive.rowCount !== 1) {
              throw new Error(
                `the backend ${String(pid)} ended before the server showed it asleep in pg_sleep`,
              );
            }
            const active = await owner.query(
              `select 1 from pg_stat_activity where pid = $1 and state = 'active' and wait_event = 'PgSleep'`,
              [pid],
            );
            if (active.rowCount === 1) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          await owner.query('select pg_terminate_backend($1)', [pid]);
        })();
        const [outcome, watcher] = await Promise.allSettled([sleeping, ended]);
        if (watcher.status === 'rejected') throw watcher.reason;
        if (outcome.status === 'rejected') throw outcome.reason;
      })
      .catch((error: unknown) => error);
    expect(isKeelwerkError(failure)).toBe(true);
    expect(failure).toMatchObject({ code: 'core.unavailable' });
    const rows = await instance.session(testNamespace, scopeA, (s) => query(s, 'select 4 as four'));
    expect(rows).toEqual([{ four: 4 }]);
  });

  test('a unit that cannot get a connection because the pool is full fails with core.unavailable, without saying the server is gone', async () => {
    const small = createPostgresInstance(
      { applicationName: 'poolfull' },
      {
        id: 'main',
        url: running.appUrl,
        strategy: 'shared-tables',
        pool: { max: 1, ...keepIdleClients },
        options: { connectionTimeoutMs: 300 },
      },
      environment(),
    );
    await small.connect();
    try {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding: () => void = () => undefined;
      const isHolding = new Promise<void>((resolve) => {
        holding = resolve;
      });
      const first = small.session(testNamespace, scopeA, async (s) => {
        await query(s, 'select 1');
        holding();
        await held;
      });
      await isHolding;
      const failure = await small
        .session(testNamespace, scopeA, (s) => query(s, 'select 2'))
        .catch((error: unknown) => error);
      release();
      await first;
      expect(isKeelwerkError(failure)).toBe(true);
      expect(failure).toMatchObject({ code: 'core.unavailable' });
      expect((failure as Error).message).not.toMatch(/unreachable/);
    } finally {
      await small.close(5000);
    }
  });

  test('a schema lock whose connection the server ends rejects, and the next lock runs', async () => {
    const created = postgresAdapter({
      ownerUrl: running.adminUrl,
      applicationName: 'loss',
    }).create(
      {
        id: 'main',
        url: running.appUrl,
        strategy: 'shared-tables',
        pool: { max: 1, ...keepIdleClients },
      },
      environment(),
    );
    const { schema } = created;
    const failure = await schema
      .lock(testNamespace, async () => {
        expectWarn('postgres schema connection');
        await terminate('loss-migrate');
        await warned;
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    await expect(schema.lock(testNamespace, async () => 1)).resolves.toBe(1);
    await created.close(5000);
  });
});
