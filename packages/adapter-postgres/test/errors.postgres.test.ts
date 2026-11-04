import { isKeelwerkError, RetryableUnitError } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPostgresInstance } from '../src/create-postgres-instance.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import { query } from './support/query.ts';
import type { TestDatabase } from './support/test-database.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, tenantA } = testScopes;

let running: TestDatabase;
let adapter: PostgresAdapterInstance;

beforeAll(async () => {
  running = await createTestDatabase('errors');
  await prepareNamespaces(running.adminUrl);
  adapter = createPostgresInstance(
    {},
    { id: 'main', url: running.appUrl, strategy: 'shared-tables', pool: { max: 4 } },
    testEnvironment(),
  );
  await adapter.connect();
  await adapter.session(testNamespace, scopeA, async (s) => {
    await query(
      s,
      `insert into app.kw_usage (scope_id, dimension, value) values ('${tenantA}', 'x', 0), ('${tenantA}', 'y', 0)`,
    );
  });
});

afterAll(async () => {
  await adapter?.close(5000);
});

const bump = (dimension: string) =>
  `update app.kw_usage set value = value + 1 where scope_id = '${tenantA}' and dimension = '${dimension}'`;

describe('error mapping', () => {
  test('a unique violation is a conflict and rolls the unit back', async () => {
    const failure = await adapter
      .session(testNamespace, scopeA, async (s) => {
        await query(s, bump('x'));
        await query(
          s,
          `insert into app.kw_usage (scope_id, dimension, value) values ('${tenantA}', 'x', 5)`,
        );
      })
      .catch((error: unknown) => error);
    expect(isKeelwerkError(failure)).toBe(true);
    expect(failure).toMatchObject({ kind: 'conflict' });
    const value = await adapter.session(testNamespace, scopeA, (s) =>
      query(s, `select value from app.kw_usage where dimension = 'x'`),
    );
    expect(value).toEqual([{ value: '0' }]);
  });

  test('a unique violation inside a savepoint is mapped there and can be caught', async () => {
    const outcome = await adapter.session(testNamespace, scopeA, async (s) => {
      const inner = await s
        .nested((n) =>
          query(
            n,
            `insert into app.kw_usage (scope_id, dimension, value) values ('${tenantA}', 'y', 5)`,
          ),
        )
        .catch((error: unknown) => error);
      return { inner, still: await query(s, 'select 1 as one') };
    });
    expect(outcome.inner).toMatchObject({ kind: 'conflict' });
    expect(outcome.still).toEqual([{ one: 1 }]);
  });

  test('a serialization failure is a RetryableUnitError', async () => {
    const failure = await adapter
      .session(
        testNamespace,
        scopeA,
        async (s) => {
          await query(s, `select value from app.kw_usage where dimension = 'x'`);
          await adapter.session(testNamespace, scopeA, (other) => query(other, bump('x')));
          await query(s, bump('x'));
        },
        { isolation: 'repeatable-read' },
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RetryableUnitError);
    expect(failure).toMatchObject({ reason: 'serialization_failure' });
  });

  test('a deadlock is a RetryableUnitError for the unit PostgreSQL picks, and the other commits', async () => {
    let firstDone = 0;
    let release: () => void = () => undefined;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cross = (first: string, second: string) =>
      adapter.session(testNamespace, scopeA, async (s) => {
        await query(s, bump(first));
        firstDone += 1;
        if (firstDone === 2) release();
        await both;
        await query(s, bump(second));
      });
    const results = await Promise.allSettled([cross('x', 'y'), cross('y', 'x')]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { reason: 'deadlock' } });
    expect(rejected[0]?.reason).toBeInstanceOf(RetryableUnitError);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  test('any other driver error passes through with its code', async () => {
    const failure = await adapter
      .session(testNamespace, scopeA, (s) => query(s, 'select * from app.no_such_table'))
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: '42P01' });
    expect(isKeelwerkError(failure)).toBe(false);
  });

  test('a statement over the unit timeout is core.timeout, with the server error as its cause', async () => {
    const failure = await adapter
      .session(testNamespace, scopeA, (s) => query(s, 'select pg_sleep(5)'), { timeoutMs: 100 })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'unavailable', code: 'core.timeout', retryable: true });
    expect(failure).toMatchObject({ cause: { code: '57014' } });
  });
});

describe('the adapter entry points', () => {
  test('unit is not available before its stores are wired', async () => {
    const failure = await adapter
      .unit(testNamespace, scopeA, async () => 1)
      .catch((e: unknown) => e);
    expect(isKeelwerkError(failure)).toBe(true);
    expect(failure).toMatchObject({ kind: 'unsupported' });
  });

  test('a closed adapter is unavailable and unhealthy', async () => {
    const other = createPostgresInstance(
      {},
      { id: 'main', url: running.appUrl, strategy: 'shared-tables' },
      testEnvironment(),
    );
    await other.connect();
    await other.close(5000);
    expect(await other.health()).toEqual({ ok: false, detail: 'not connected' });
    await expect(other.session(testNamespace, scopeA, async () => 1)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
