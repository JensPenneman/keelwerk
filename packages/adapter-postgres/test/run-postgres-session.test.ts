import { CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import { describe, expect, test } from 'vitest';
import { runPostgresSession } from '../src/run-postgres-session.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const lost = (): Error =>
  Object.assign(new Error('terminating connection due to administrator command'), {
    code: '57P01',
  });

function endedPool(fails: (connection: number, text: string) => Error | undefined) {
  const counts = { taken: 0 };
  const fake = {
    connect: async () => {
      counts.taken += 1;
      const connection = counts.taken;
      return {
        query: async (text: string) => {
          const failure = fails(connection, text);
          if (failure !== undefined) throw failure;
          return { rows: [], rowCount: 0, command: 'SELECT' };
        },
        release: () => undefined,
      };
    },
    end: async () => undefined,
  };
  return {
    counts,
    db: new Kysely<never>({ dialect: new PostgresDialect({ pool: fake as never }) }),
  };
}

function requestOn(db: Kysely<never>, poolMax: number) {
  const env = testEnvironment();
  return {
    db: db as never,
    poolMax,
    namespace: testNamespace,
    scope: testScopes.scopeA,
    options: undefined,
    deploymentId: env.deploymentId,
    log: env.log,
    tracer: env.tracer,
    // runPostgresSession does not read the parts
    parts: {} as never,
  };
}

describe('runPostgresSession on connections the server ended', () => {
  test('begins again on another connection until one is good, and runs the work once', async () => {
    const { counts, db } = endedPool((connection, text) =>
      connection <= 2 && !text.startsWith('rollback') ? lost() : undefined,
    );
    let ran = 0;
    const value = await runPostgresSession(requestOn(db, 3), async () => {
      ran += 1;
      return 'done';
    });
    expect(value).toBe('done');
    expect(ran).toBe(1);
    expect(counts.taken).toBe(3);
  });

  test('gives up with core.unavailable after poolMax more connections, and never runs the work', async () => {
    const { counts, db } = endedPool((_, text) =>
      text.startsWith('rollback') ? undefined : lost(),
    );
    let ran = 0;
    const failure = await runPostgresSession(requestOn(db, 3), async () => {
      ran += 1;
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'core.unavailable' });
    expect(ran).toBe(0);
    expect(counts.taken).toBe(4);
  });

  test('never begins a unit again once its work has started', async () => {
    const { counts, db } = endedPool((_, text) =>
      text === 'select 1 as work' ? lost() : undefined,
    );
    let ran = 0;
    const failure = await runPostgresSession(requestOn(db, 3), async (session) => {
      ran += 1;
      await session.db.executeQuery(CompiledQuery.raw('select 1 as work'));
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'core.unavailable' });
    expect(ran).toBe(1);
    expect(counts.taken).toBe(1);
  });

  test('does not begin again on a failure at the opening that is not a connection failure', async () => {
    const refused = Object.assign(new Error('permission denied'), { code: '42501' });
    const { counts, db } = endedPool((_, text) => (text.startsWith('begin') ? refused : undefined));
    const failure = await runPostgresSession(requestOn(db, 3), async () => 'done').catch(
      (error: unknown) => error,
    );
    expect(failure).toBe(refused);
    expect(counts.taken).toBe(1);
  });

  test('begins again when the connection is lost at a scope setting', async () => {
    const { counts, db } = endedPool((connection, text) =>
      connection === 1 && !text.startsWith('begin') && !text.startsWith('rollback')
        ? lost()
        : undefined,
    );
    const value = await runPostgresSession(requestOn(db, 3), async () => 'done');
    expect(value).toBe('done');
    expect(counts.taken).toBe(2);
  });

  test('takes no further connection when the signal was aborted while the first attempt was lost', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped');
    const { counts, db } = endedPool((_, text) => {
      if (!text.startsWith('begin')) return undefined;
      controller.abort(reason);
      return lost();
    });
    const failure = await runPostgresSession(
      { ...requestOn(db, 3), options: { signal: controller.signal } },
      async () => 'done',
    ).catch((error: unknown) => error);
    expect(failure).toBe(reason);
    expect(counts.taken).toBe(1);
  });
});
