import type { StorageScope } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { frameworkTablesDdl, rlsPoliciesDdl } from '../src/index.ts';
import {
  type PgliteAdapter,
  pgliteAdapter,
  provisionApplicationRole,
} from '../src/pglite/index.ts';
import { backendScope } from './support/backend-scope.ts';
import { control } from './support/control.ts';
import { deployment } from './support/deployment.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { inUnit } from './support/in-unit.ts';
import { namespaceRef } from './support/namespace-ref.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await provisionedPglite();
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

describe('the control store on PGlite', () => {
  const insert = `insert into ${control}.kw_scope_keys (scope_id, level, version, wrapped, created_at)
      values ($1, 'deployment', 1, '\\x03', now())`;
  const deploymentId = '00000000-0000-4000-8000-0000000000d1';

  test('wrapped scope keys are reachable from deployment units only', async () => {
    for (const scope of [storageTenant(tenantA), backendScope, namespaceScope]) {
      await expect(
        inUnit(adapter, scope, async (u) => runStatement(u, insert, [deploymentId])),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await inUnit(adapter, deploymentScope, async (u) => runStatement(u, insert, [deploymentId]));
    const seen = async (scope: StorageScope): Promise<number> =>
      inUnit(
        adapter,
        scope,
        async (u) => (await runStatement(u, `select 1 from ${control}.kw_scope_keys`)).rows.length,
      );
    expect(await seen(storageTenant(tenantA))).toBe(0);
    expect(await seen(backendScope)).toBe(0);
    expect(await seen(deploymentScope)).toBe(1);
  });

  test('the control root admits the deployment id only', async () => {
    await inUnit(adapter, deploymentScope, async (u) =>
      runStatement(u, `insert into ${control}.kw_positions values ($1, 1, 1)`, [deployment]),
    );
    const seen = async (scope: StorageScope): Promise<number> =>
      inUnit(
        adapter,
        scope,
        async (u) => (await runStatement(u, `select 1 from ${control}.kw_positions`)).rows.length,
      );
    expect(await seen(deploymentScope)).toBe(1);
    expect(await seen(storageTenant(deployment))).toBe(0);
    expect(await seen(backendScope)).toBe(0);
  });

  test('a namespace has no scope keys table', async () => {
    const found = await adapter.asOwner(async (database) =>
      database.query(
        `select 1 from information_schema.tables where table_schema = $1 and table_name = 'kw_scope_keys'`,
        [ns],
      ),
    );
    expect(found.rows).toHaveLength(0);
  });

  test('a deployment unit with an empty deployment id is refused', {
    timeout: 60_000,
  }, async () => {
    const bare = pgliteAdapter({ deploymentId: '' });
    await bare.connect();
    try {
      await expect(bare.unit(namespaceRef, deploymentScope, async () => 'never')).rejects.toThrow(
        /deployment id/,
      );
    } finally {
      await bare.close(1000);
    }
  });
});

describe('append-only shapes on PGlite', () => {
  test('kw_shapes is append-only for the application role', async () => {
    const scope = storageTenant(tenantA);
    await inUnit(adapter, scope, async (u) =>
      runStatement(u, `insert into ${ns}.kw_shapes values ('\\x01', '{}')`),
    );
    await expect(
      inUnit(adapter, scope, async (u) =>
        runStatement(u, `update ${ns}.kw_shapes set tracks = '[]'`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inUnit(adapter, scope, async (u) => runStatement(u, `delete from ${ns}.kw_shapes`)),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('quoted identifiers on PGlite', () => {
  test('a root that is a reserved word applies', async () => {
    const found = await adapter.asOwner(async (database) => {
      for (const statement of [...frameworkTablesDdl('order'), ...rlsPoliciesDdl('order')]) {
        await database.query(statement);
      }
      await provisionApplicationRole(database, { root: 'order', role: 'kw_app' });
      return database.query(
        `select 1 from information_schema.tables where table_schema = 'order' and table_name = 'kw_jobs'`,
      );
    });
    expect(found.rows).toHaveLength(1);
  });
});

describe('the migration history on PGlite', () => {
  test('the application role reads it and migrations alone write it', async () => {
    await adapter.asOwner(async (database) =>
      database.query(`insert into ${ns}.kw_migrations values ('core', '0001', 'ab', now(), 1, 1)`),
    );
    const rows = await inUnit(adapter, storageTenant(tenantA), async (u) =>
      runStatement(u, `select 1 from ${ns}.kw_migrations`),
    );
    expect(rows.rows).toHaveLength(1);
    await expect(
      inUnit(adapter, storageTenant(tenantA), async (u) =>
        runStatement(
          u,
          `insert into ${ns}.kw_migrations values ('core', '0002', 'ab', now(), 1, 1)`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
