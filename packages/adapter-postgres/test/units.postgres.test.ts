import type { PlacementConfig, StorageScope } from '@keelwerk/core';
import pg from 'pg';
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

const { backendId, deploymentId, scopeA, scopeB, tenantA } = testScopes;

let running: TestDatabase;
let adapter: PostgresAdapterInstance;
let control: PostgresAdapterInstance;

const controlNamespace = { ...testNamespace, id: 'ns-control', root: 'kw__control' };

function placement(url: string): PlacementConfig {
  // One connection: every unit after the first reuses a session that earlier held another scope.
  return { id: 'main', url, strategy: 'shared-tables', pool: { max: 1 } };
}

beforeAll(async () => {
  running = await createTestDatabase('units');
  await prepareNamespaces(running.adminUrl);
  adapter = createPostgresInstance({}, placement(running.appUrl), testEnvironment());
  await adapter.connect();
  control = createPostgresInstance({}, placement(running.appUrl), testEnvironment());
  await control.connect();
});

afterAll(async () => {
  await adapter?.close(5000);
  await control?.close(5000);
});

const insertPosition = (scopeId: string) =>
  `insert into app.kw_positions (scope_id, next, epoch) values ('${scopeId}', 1, 0)`;

describe('connect', () => {
  test('declares the PostgreSQL capabilities on PostgreSQL 18', async () => {
    expect(running.version).toContain('PostgreSQL 18');
    const capabilities = await adapter.connect();
    expect(capabilities).toMatchObject({
      dialect: 'postgres',
      rowLevelSecurity: true,
      rowLocks: { skipLocked: true, noWait: true },
      jobs: 'skip-locked',
    });
  });

  test('health is ok while connected', async () => {
    expect(await adapter.health()).toEqual({ ok: true });
  });

  test('identity names the cluster and its timeline', async () => {
    const identity = await adapter.identity();
    expect(identity.systemId).toMatch(/^\d{10,}$/);
    expect(identity.timeline).toBe('1');
    expect(await adapter.identity()).toEqual(identity);
  });

  test('refuses a superuser', async () => {
    const refused = createPostgresInstance({}, placement(running.adminUrl), testEnvironment());
    await expect(refused.connect()).rejects.toMatchObject({
      message: expect.stringContaining('superuser'),
    });
  });

  test('refuses a role with BYPASSRLS', async () => {
    const admin = new pg.Client({ connectionString: running.adminUrl });
    await admin.connect();
    await admin.query(`create role kw_bypass login password 'kw_bypass' nosuperuser bypassrls`);
    await admin.end();
    const url = running.appUrl.replace('kw_app:kw_app@', 'kw_bypass:kw_bypass@');
    const refused = createPostgresInstance({}, placement(url), testEnvironment());
    await expect(refused.connect()).rejects.toMatchObject({
      message: expect.stringContaining('bypass row-level security'),
    });
  });

  test('a placement strategy other than shared-tables is refused', async () => {
    const refused = createPostgresInstance(
      {},
      { id: 'main', url: running.appUrl, strategy: 'database-per-tenant' },
      testEnvironment(),
    );
    await expect(refused.connect()).rejects.toMatchObject({ kind: 'unsupported' });
  });

  test('identity of an adapter that is not connected rejects', async () => {
    const idle = createPostgresInstance({}, placement(running.appUrl), testEnvironment());
    await expect(idle.identity()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('a placement without a url is refused', async () => {
    const refused = createPostgresInstance(
      {},
      { id: 'main', strategy: 'shared-tables' },
      testEnvironment(),
    );
    await expect(refused.connect()).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('unit settings', () => {
  test('a command runs at read committed, read write, as the application role', async () => {
    const seen = await adapter.session(testNamespace, scopeA, async (s) => ({
      isolation: await query(s, "select current_setting('transaction_isolation') as value"),
      readOnly: await query(s, "select current_setting('transaction_read_only') as value"),
      role: await query(s, 'select current_user as name'),
      idle: await query(
        s,
        "select current_setting('idle_in_transaction_session_timeout') as value",
      ),
    }));
    expect(seen.isolation).toEqual([{ value: 'read committed' }]);
    expect(seen.readOnly).toEqual([{ value: 'off' }]);
    expect(seen.role).toEqual([{ name: 'kw_app' }]);
    expect(seen.idle).toEqual([{ value: '30s' }]);
  });

  test('a query runs at repeatable read, read only, and refuses a write', async () => {
    const seen = await adapter.session(
      testNamespace,
      scopeA,
      async (s) => {
        const isolation = await query(
          s,
          "select current_setting('transaction_isolation') as value",
        );
        const readOnly = await query(s, "select current_setting('transaction_read_only') as value");
        const write = await s
          .nested((inner) => query(inner, insertPosition(tenantA)))
          .catch((error: unknown) => error);
        return { isolation, readOnly, write };
      },
      { readOnly: true },
    );
    expect(seen.isolation).toEqual([{ value: 'repeatable read' }]);
    expect(seen.readOnly).toEqual([{ value: 'on' }]);
    expect(seen.write).toMatchObject({ code: '25006' });
  });

  test('isolation and timeout options apply, locally to the unit', async () => {
    const inside = await adapter.session(
      testNamespace,
      scopeA,
      async (s) => ({
        isolation: await query(s, "select current_setting('transaction_isolation') as value"),
        timeout: await query(s, "select current_setting('statement_timeout') as value"),
      }),
      { isolation: 'serializable', timeoutMs: 1500 },
    );
    expect(inside.isolation).toEqual([{ value: 'serializable' }]);
    expect(inside.timeout).toEqual([{ value: '1500ms' }]);
    const after = await adapter.session(testNamespace, scopeA, (s) =>
      query(s, "select current_setting('statement_timeout') as value"),
    );
    expect(after).toEqual([{ value: '0' }]);
  });

  test('a unit names exactly one scope', async () => {
    const settings = async (scope: StorageScope): Promise<unknown> =>
      adapter.session(testNamespace, scope, (s) =>
        query(
          s,
          `select nullif(current_setting('keelwerk.tenant_id', true), '') as tenant,
                  nullif(current_setting('keelwerk.backend_id', true), '') as backend,
                  nullif(current_setting('keelwerk.scope', true), '') as scope`,
        ),
      );
    expect(await settings(scopeA)).toEqual([{ tenant: tenantA, backend: null, scope: null }]);
    expect(await settings({ level: 'backend', backendId })).toEqual([
      { tenant: null, backend: backendId, scope: null },
    ]);
    expect(await settings({ level: 'namespace', reason: 'test' })).toEqual([
      { tenant: null, backend: null, scope: 'namespace' },
    ]);
  });

  test('a deployment unit names the deployment id of the environment', async () => {
    const bare = createPostgresInstance({}, placement(running.appUrl), testEnvironment(''));
    await bare.connect();
    try {
      await expect(
        bare.session(testNamespace, { level: 'deployment' }, async () => 1),
      ).rejects.toThrow('deployment id');
    } finally {
      await bare.close(5000);
    }
    const seen = await control.session(controlNamespace, { level: 'deployment' }, (s) =>
      query(s, `select current_setting('keelwerk.deployment_id', true) as id`),
    );
    expect(seen).toEqual([{ id: deploymentId }]);
  });

  test('an aborted signal refuses the unit before it starts', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(
      adapter.session(testNamespace, scopeA, async () => 1, { signal: controller.signal }),
    ).rejects.toThrow('stopped');
  });
});

describe('tenant isolation under forced row-level security', () => {
  test('a second tenant sees nothing of the first, and cannot write its rows', async () => {
    await adapter.session(testNamespace, scopeA, (s) => query(s, insertPosition(tenantA)));

    const own = await adapter.session(testNamespace, scopeA, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(own).toEqual([{ scopeId: tenantA }]);

    const other = await adapter.session(testNamespace, scopeB, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(other).toEqual([]);

    const forged = await adapter
      .session(testNamespace, scopeB, (s) => query(s, insertPosition(tenantA)))
      .catch((error: unknown) => error);
    expect(forged).toMatchObject({ code: '42501' });

    const updated = await adapter.session(testNamespace, scopeB, (s) =>
      query(s, `update app.kw_positions set next = 99 where scope_id = '${tenantA}' returning 1`),
    );
    expect(updated).toEqual([]);
    const intact = await adapter.session(testNamespace, scopeA, (s) =>
      query(s, 'select next from app.kw_positions'),
    );
    expect(intact).toEqual([{ next: '1' }]);
  });

  test('backend and deployment units see no tenant rows, on a connection that ran a tenant unit', async () => {
    const backend = await adapter.session(testNamespace, { level: 'backend', backendId }, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(backend).toEqual([]);
    const backendWrite = await adapter
      .session(testNamespace, { level: 'backend', backendId }, (s) =>
        query(s, insertPosition(tenantA)),
      )
      .catch((error: unknown) => error);
    expect(backendWrite).toMatchObject({ code: '42501' });

    await control.session(controlNamespace, { level: 'deployment' }, (s) =>
      query(
        s,
        `insert into kw__control.kw_positions (scope_id, next, epoch) values ('${deploymentId}', 1, 0)`,
      ),
    );
    const deployment = await control.session(testNamespace, { level: 'deployment' }, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(deployment).toEqual([]);
    const own = await control.session(controlNamespace, { level: 'deployment' }, (s) =>
      query(s, 'select scope_id as "scopeId" from kw__control.kw_positions'),
    );
    expect(own).toEqual([{ scopeId: deploymentId }]);
  });

  test('a tenant unit sees nothing of the control root', async () => {
    const seen = await adapter.session(controlNamespace, scopeA, (s) =>
      query(s, 'select scope_id as "scopeId" from kw__control.kw_positions'),
    );
    expect(seen).toEqual([]);
  });

  test('a namespace unit reaches rows only through the maintenance policy', async () => {
    const seen = await adapter.session(testNamespace, { level: 'namespace', reason: 'test' }, (s) =>
      query(s, 'select scope_id as "scopeId" from app.kw_positions'),
    );
    expect(seen).toEqual([{ scopeId: tenantA }]);
  });

  test('the application role cannot switch row-level security off', async () => {
    const denied = await adapter
      .session(testNamespace, scopeA, (s) =>
        query(s, 'alter table app.kw_positions disable row level security'),
      )
      .catch((error: unknown) => error);
    expect(denied).toMatchObject({ code: '42501' });
  });
});
