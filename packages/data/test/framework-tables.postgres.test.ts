import type { Client, QueryConfig, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applicationRoleDdl, frameworkTablesDdl, rlsPoliciesDdl } from '../src/index.ts';
import { applyFrameworkTables } from './support/apply-framework-tables.ts';
import { asBackend } from './support/as-backend.ts';
import { asNamespace } from './support/as-namespace.ts';
import { asTenant } from './support/as-tenant.ts';
import { backend } from './support/backend.ts';
import { connect } from './support/connect.ts';
import { control } from './support/control.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { deployment } from './support/deployment.ts';
import { enqueueJob } from './support/enqueue-job-seed.ts';
import { laneCounts } from './support/lane-counts-seed.ts';
import { ns } from './support/ns.ts';
import { seeds } from './support/seeds.ts';
import type { Settings } from './support/settings.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';
import type { TestDatabase } from './support/test-database.ts';
import { unit } from './support/unit.ts';

const asDeployment: Settings = { 'keelwerk.deployment_id': deployment };
const asDeploymentMarker: Settings = { 'keelwerk.scope': 'deployment' };
const deploymentUnits: ReadonlyArray<readonly [string, Settings]> = [
  ['deployment_id', asDeployment],
  ['scope = deployment', asDeploymentMarker],
];

/** An insert into `table` with `$1` as its scope; the job tables also take a lane id as `$2`. */
function insertFor(table: string, scope: string, lane: string): QueryConfig {
  if (table === 'kw_jobs') {
    return {
      text: `insert into ${ns}.kw_jobs (scope_id, scope, lane_id, queue, kind, state, principal, causation, build_id, revision, input, created_at)
        values ($1, jsonb_build_object('level', 'tenant', 'tenantId', $1::uuid::text), $2, 'q', 'action', 'available', '{}', '{}', 'b', 1, '{}', now())`,
      values: [scope, lane],
    };
  }
  if (table === 'kw_job_lane_counts') {
    return {
      text: `insert into ${ns}.kw_job_lane_counts (lane_id, kind, scope_id, value) values ($2, 'enqueued', $1, 0)`,
      values: [scope, lane],
    };
  }
  const found = seeds.find(([name]) => name === table);
  if (found === undefined) throw new Error(`no seed for ${table}`);
  return { text: found[1], values: [scope] };
}

let postgres: TestDatabase;
let admin: Client;
let app: Client;
let laneOfA = '';

const count = async (table: string): Promise<number> =>
  Number((await app.query<{ n: string }>(`select count(*) as n from ${ns}.${table}`)).rows[0]?.n);

/** Rows a statement changed; a statement the role has no privilege for changed none. */
async function changed(settings: Settings, text: string, values: unknown[]): Promise<number> {
  try {
    return (await unit(app, settings, async () => app.query(text, values))).rowCount ?? 0;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '42501') return 0;
    throw error;
  }
}

const insertRejected = async (settings: Settings, query: QueryConfig): Promise<void> => {
  await expect(
    unit(app, settings, async (): Promise<QueryResult> => app.query(query)),
  ).rejects.toMatchObject({ code: '42501' });
};

beforeAll(async () => {
  postgres = await createTestDatabase('framework_tables');
  admin = await connect(postgres.adminUrl);
  await applyFrameworkTables(admin);
  app = await connect(postgres.appUrl);
  for (const id of [tenantA, tenantB]) {
    await unit(app, asTenant(id), async () => {
      for (const [, statement] of seeds) await app.query(statement, [id]);
      await app.query(laneCounts, [id]);
      await app.query(enqueueJob, [id]);
    });
  }
  await unit(app, asBackend, async () => {
    await app.query(insertFor('kw_usage', backend, '').text, [backend]);
  });
  laneOfA = await unit(
    app,
    asTenant(tenantA),
    async () =>
      (await app.query<{ id: string }>(`select id::text from ${ns}.kw_job_lanes`)).rows[0]?.id ??
      '',
  );
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

const scopedTables = [...seeds.map(([table]) => table), 'kw_job_lane_counts', 'kw_jobs'];
const appendOnly = ['kw_events'];

describe('tenant isolation', () => {
  test('the application role cannot bypass row-level security', async () => {
    const role = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const forced = await admin.query<{ n: string }>(
      `select count(*) as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = $1 and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity`,
      [ns],
    );
    expect(Number(forced.rows[0]?.n)).toBe(scopedTables.length);
  });

  test.each(scopedTables)('%s: a tenant sees only its own rows', async (table) => {
    for (const mine of [tenantA, tenantB]) {
      const rows = await unit(
        app,
        asTenant(mine),
        async () =>
          (await app.query<{ scopeId: string }>(`select scope_id as "scopeId" from ${ns}.${table}`))
            .rows,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.scopeId).toBe(mine);
    }
  });

  test.each(scopedTables)(
    "%s: a tenant can neither change nor insert another tenant's rows",
    async (table) => {
      const update = `update ${ns}.${table} set scope_id = scope_id where scope_id = $1`;
      expect(await changed(asTenant(tenantA), update, [tenantB])).toBe(0);
      const remove = `delete from ${ns}.${table} where scope_id = $1`;
      expect(await changed(asTenant(tenantA), remove, [tenantB])).toBe(0);
      await insertRejected(asTenant(tenantA), insertFor(table, tenantB, laneOfA));
    },
  );

  test.each(appendOnly)('%s: the application role never updates or deletes', async (table) => {
    await expect(
      unit(app, asTenant(tenantA), async () =>
        app.query(`update ${ns}.${table} set scope_id = scope_id`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      unit(app, asTenant(tenantA), async () => app.query(`delete from ${ns}.${table}`)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('kw_shapes is append-only for the application role', async () => {
    await app.query(`insert into ${ns}.kw_shapes values ('\\x01', '{}')`);
    await expect(app.query(`update ${ns}.kw_shapes set tracks = '[]'`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app.query(`delete from ${ns}.kw_shapes`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  const foreignUnits: ReadonlyArray<readonly [string, Settings]> = [
    ['backend', asBackend],
    ...deploymentUnits,
  ];

  describe.each(foreignUnits)('a %s-scope unit', (_name, settings) => {
    test.each(scopedTables)('%s: sees no tenant row and changes none', async (table) => {
      const rows = await unit(
        app,
        settings,
        async () =>
          (await app.query<{ scopeId: string }>(`select scope_id as "scopeId" from ${ns}.${table}`))
            .rows,
      );
      expect(rows.filter((row) => row.scopeId === tenantA || row.scopeId === tenantB)).toEqual([]);
      const tenants = [tenantA, tenantB];
      expect(
        await changed(
          settings,
          `update ${ns}.${table} set scope_id = scope_id where scope_id = any ($1::uuid[])`,
          [tenants],
        ),
      ).toBe(0);
      expect(
        await changed(settings, `delete from ${ns}.${table} where scope_id = any ($1::uuid[])`, [
          tenants,
        ]),
      ).toBe(0);
      await insertRejected(settings, insertFor(table, tenantA, laneOfA));
    });
  });

  test('a backend-scope unit reads and writes its own rows', async () => {
    const rows = await unit(
      app,
      asBackend,
      async () =>
        (await app.query<{ scopeId: string }>(`select scope_id as "scopeId" from ${ns}.kw_usage`))
          .rows,
    );
    expect(rows).toEqual([{ scopeId: backend }]);
  });

  test('a unit with a tenant and a backend setting sees the tenant only', async () => {
    const rows = await unit(
      app,
      { ...asTenant(tenantA), ...asBackend },
      async () =>
        (await app.query<{ scopeId: string }>(`select scope_id as "scopeId" from ${ns}.kw_usage`))
          .rows,
    );
    expect(rows).toEqual([{ scopeId: tenantA }]);
  });

  test('a statement outside any unit sees no rows', async () => {
    expect(await count('kw_events')).toBe(0);
  });

  test('a pooled connection that ran a tenant unit serves a backend and a namespace unit (decision 111)', async () => {
    await unit(app, asTenant(tenantA), async () => app.query(`select 1 from ${ns}.kw_events`));
    const settingAfter = await app.query<{ value: string | null }>(
      `select current_setting('keelwerk.tenant_id', true) as value`,
    );
    expect(settingAfter.rows[0]?.value).toBe('');
    const seen = await unit(
      app,
      asBackend,
      async () => (await app.query(`select 1 from ${ns}.kw_events`)).rowCount,
    );
    expect(seen).toBe(0);
    const namespaceSeen = await unit(
      app,
      asNamespace,
      async () => (await app.query(`select 1 from ${ns}.kw_events`)).rowCount,
    );
    expect(namespaceSeen).toBe(2);
  });
});

describe('the control store', () => {
  const insert = `insert into ${control}.kw_scope_keys (scope_id, level, version, wrapped, created_at)
      values ($1, 'deployment', 1, '\\x03', now())`;

  test('wrapped scope keys are reachable from deployment units only', async () => {
    await insertRejected(asTenant(tenantA), { text: insert, values: [deployment] });
    await insertRejected(asBackend, { text: insert, values: [deployment] });
    await insertRejected(asDeploymentMarker, { text: insert, values: [deployment] });
    await insertRejected(asNamespace, { text: insert, values: [deployment] });
    await unit(app, asDeployment, async () => app.query(insert, [deployment]));
    const seen = async (settings: Settings): Promise<number | null> =>
      unit(
        app,
        settings,
        async () => (await app.query(`select 1 from ${control}.kw_scope_keys`)).rowCount,
      );
    expect(await seen(asTenant(tenantA))).toBe(0);
    expect(await seen(asBackend)).toBe(0);
    expect(await seen(asDeployment)).toBe(1);
  });

  test('the control root admits the deployment id only', async () => {
    await unit(app, asDeployment, async () =>
      app.query(`insert into ${control}.kw_positions values ($1, 1, 1)`, [deployment]),
    );
    const seen = async (settings: Settings): Promise<number | null> =>
      unit(
        app,
        settings,
        async () => (await app.query(`select 1 from ${control}.kw_positions`)).rowCount,
      );
    expect(await seen(asDeployment)).toBe(1);
    expect(await seen(asTenant(deployment))).toBe(0);
    expect(await seen(asBackend)).toBe(0);
    expect(await seen(asDeploymentMarker)).toBe(0);
  });

  test('a namespace has no scope keys table', async () => {
    const found = await admin.query(
      `select 1 from information_schema.tables where table_schema = $1 and table_name = 'kw_scope_keys'`,
      [ns],
    );
    expect(found.rowCount).toBe(0);
  });
});

describe('quoted identifiers', () => {
  test('a root that is a reserved word applies', async () => {
    for (const statement of [
      ...frameworkTablesDdl('order'),
      ...rlsPoliciesDdl('order'),
      ...applicationRoleDdl('order', 'kw_app'),
    ]) {
      await admin.query(statement);
    }
    const found = await admin.query(
      `select 1 from information_schema.tables where table_schema = 'order' and table_name = 'kw_jobs'`,
    );
    expect(found.rowCount).toBe(1);
  });
});

describe('the migration history', () => {
  test('the application role reads it and migrations alone write it', async () => {
    await admin.query(`insert into ${ns}.kw_migrations values ('core', '0001', 'ab', now(), 1, 1)`);
    const rows = await app.query(`select 1 from ${ns}.kw_migrations`);
    expect(rows.rowCount).toBe(1);
    await expect(
      app.query(`insert into ${ns}.kw_migrations values ('core', '0002', 'ab', now(), 1, 1)`),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
