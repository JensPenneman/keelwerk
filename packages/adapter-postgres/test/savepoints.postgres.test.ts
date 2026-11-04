import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPostgresInstance } from '../src/create-postgres-instance.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import { query } from './support/query.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeB, tenantB } = testScopes;

let adapter: PostgresAdapterInstance;

beforeAll(async () => {
  const database = await createTestDatabase('savepoints');
  await prepareNamespaces(database.adminUrl);
  adapter = createPostgresInstance(
    {},
    { id: 'main', url: database.appUrl, strategy: 'shared-tables', pool: { max: 1 } },
    testEnvironment(),
  );
  await adapter.connect();
});

afterAll(async () => {
  await adapter?.close(5000);
});

const insertPosition = (scopeId: string) =>
  `insert into app.kw_positions (scope_id, next, epoch) values ('${scopeId}', 1, 0)`;

describe('commit, rollback, savepoints', () => {
  test('a thrown error rolls the unit back and propagates unchanged', async () => {
    const failure = new Error('handler failed');
    await expect(
      adapter.session(testNamespace, scopeB, async (s) => {
        await query(s, insertPosition(tenantB));
        throw failure;
      }),
    ).rejects.toBe(failure);
    const rows = await adapter.session(testNamespace, scopeB, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(rows).toEqual([]);
  });

  test('afterCommit runs once, after the commit, and never after a rollback', async () => {
    const calls: string[] = [];
    await adapter.session(testNamespace, scopeB, async (s) => {
      s.afterCommit(() => calls.push('committed'));
      calls.push('body');
    });
    expect(calls).toEqual(['body', 'committed']);
    await adapter
      .session(testNamespace, scopeB, async (s) => {
        s.afterCommit(() => calls.push('rolled back'));
        throw new Error('no');
      })
      .catch(() => undefined);
    expect(calls).toEqual(['body', 'committed']);
  });

  test('a statement error swallowed outside a savepoint rejects the unit and skips afterCommit', async () => {
    const calls: string[] = [];
    const failure = await adapter
      .session(testNamespace, scopeB, async (s) => {
        s.afterCommit(() => calls.push('committed'));
        await query(s, insertPosition(tenantB));
        await query(s, insertPosition(tenantB)).catch(() => undefined);
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: '25P02' });
    expect(calls).toEqual([]);
    const rows = await adapter.session(testNamespace, scopeB, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(rows).toEqual([]);
  });

  test('a nested unit is a savepoint: its failure rolls back only its own work and callbacks', async () => {
    const calls: string[] = [];
    await adapter.session(testNamespace, scopeB, async (s) => {
      await query(s, insertPosition(tenantB));
      const failure = await s
        .nested(async (inner) => {
          await query(inner, `update app.kw_positions set next = 7 where scope_id = '${tenantB}'`);
          inner.afterCommit(() => calls.push('inner'));
          throw new Error('inner failed');
        })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ message: 'inner failed' });
      await s.nested(async (inner) => {
        expect(inner.scope).toEqual(scopeB);
        inner.afterCommit(() => calls.push('kept'));
      });
      s.afterCommit(() => calls.push('outer'));
    });
    const rows = await adapter.session(testNamespace, scopeB, (s) =>
      query(s, 'select next from app.kw_positions'),
    );
    expect(rows).toEqual([{ next: '1' }]);
    expect(calls).toEqual(['kept', 'outer']);
  });
});
