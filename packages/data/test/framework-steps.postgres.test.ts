import { readFileSync } from 'node:fs';
import type { NamespaceRef, SchemaOperations } from '@keelwerk/core';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  frameworkStepChecksum,
  frameworkSteps,
  frameworkTrack,
  pgSchemaConnection,
  postgresSchemaOperations,
} from '../src/index.ts';
import { asBackend } from './support/as-backend.ts';
import { asNamespace } from './support/as-namespace.ts';
import { asTenant } from './support/as-tenant.ts';
import { connect } from './support/connect.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { deployment } from './support/deployment.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { fixedInstant } from './support/fixed-instant.ts';
import { namespaceRef } from './support/namespace-ref.ts';
import type { Settings } from './support/settings.ts';
import { storeControlNamespace } from './support/store-control-namespace.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';
import type { TestDatabase } from './support/test-database.ts';
import { unit } from './support/unit.ts';

const dump = readFileSync(new URL('./fixtures/m1-dump.sql', import.meta.url), 'utf8');
const asDeployment: Settings = { 'keelwerk.deployment_id': deployment };

const schemaOf = (postgres: TestDatabase): SchemaOperations =>
  postgresSchemaOperations(
    pgSchemaConnection(async (url) => connect(url ?? postgres.adminUrl)),
    { role: 'kw_app', clock: { now: () => fixedInstant } },
  );

const frameworkRows = async (admin: Client, root: string): Promise<readonly string[]> =>
  (
    await admin.query<{ id: string }>(
      `select id from "${root}".kw_migrations where track = $1 order by id`,
      [frameworkTrack],
    )
  ).rows.map((row) => row.id);

describe('the M1 dump on PostgreSQL', () => {
  let postgres: TestDatabase;
  let admin: Client;

  beforeAll(async () => {
    postgres = await createTestDatabase('framework_dump');
    admin = await connect(postgres.adminUrl);
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
  });

  test('the M1 dump migrates to 0002 on PostgreSQL', async () => {
    await admin.query(dump);
    const schema = schemaOf(postgres);
    await schema.provision(exampleNamespace, []);
    await schema.provision(storeControlNamespace, []);
    for (const root of ['example', 'kw__control']) {
      expect(await frameworkRows(admin, root)).toEqual(['0001', '0002']);
      const found = await admin.query<{ id: string; durationMs: number }>(
        `select id, duration_ms as "durationMs" from "${root}".kw_migrations where track = $1 order by id`,
        [frameworkTrack],
      );
      expect(found.rows[0]?.durationMs).toBe(0);
      const tables = await admin.query<{ present: boolean }>(
        `select to_regclass('"${root}".kw_consumers') is not null as present`,
      );
      expect(tables.rows[0]?.present).toBe(true);
    }
    const ledger = await admin.query<{ present: boolean }>(
      `select to_regclass('"kw__control".kw_ledger') is not null as present`,
    );
    expect(ledger.rows[0]?.present).toBe(true);
    const usage = await admin.query<{ value: string }>(`select value from "example".kw_usage`);
    expect(usage.rows).toEqual([{ value: '7' }]);
    const library = await admin.query<{ id: string }>(
      `select id from "example".kw_migrations where track = 'library'`,
    );
    expect(library.rows).toEqual([{ id: '0001-initial' }]);
    const before = (await schema.history(exampleNamespace)).length;
    await schema.provision(exampleNamespace, []);
    expect((await schema.history(exampleNamespace)).length).toBe(before);
  });
});

describe('fresh roots on PostgreSQL', () => {
  const fresh: NamespaceRef = { ...namespaceRef, id: 'ns-fresh', root: 'fresh_ns' };
  const racing: NamespaceRef = { ...namespaceRef, id: 'ns-racing', root: 'racing_ns' };
  let postgres: TestDatabase;
  let admin: Client;
  let app: Client;

  beforeAll(async () => {
    postgres = await createTestDatabase('framework_steps');
    admin = await connect(postgres.adminUrl);
    const schema = schemaOf(postgres);
    await schema.provision(fresh, []);
    await schema.provision(storeControlNamespace, []);
    app = await connect(postgres.appUrl);
  }, 120_000);

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  test('a fresh namespace gets both steps', async () => {
    const history = (await schemaOf(postgres).history(fresh)).filter(
      (row) => row.track === frameworkTrack,
    );
    expect(history.map((row) => row.id)).toEqual(['0001', '0002']);
    expect(history.map((row) => row.checksum)).toEqual(
      frameworkSteps.map((step) => frameworkStepChecksum(step, {})),
    );
    for (const row of history) expect(row.appliedAt.toString()).toBe(fixedInstant.toString());
  });

  test('two provisions at once record each step once', async () => {
    const schema = schemaOf(postgres);
    await Promise.all([schema.provision(racing, []), schema.provision(racing, [])]);
    expect(await frameworkRows(admin, 'racing_ns')).toEqual(['0001', '0002']);
  });

  const scopedInserts: readonly (readonly [string, string])[] = [
    ['kw_consumers', `insert into fresh_ns.kw_consumers values ('c', $1, 1, now())`],
    ['kw_parked', `insert into fresh_ns.kw_parked values ('c', $1, 'a.b', $1, 1, 3, '{}', now())`],
    [
      'kw_stream_records',
      `insert into fresh_ns.kw_stream_records values ($1, 's', 'k', 1, now(), '{}')`,
    ],
    ['kw_schedules', `insert into fresh_ns.kw_schedules values ($1, 'daily', null, now(), now())`],
  ];

  test("a tenant sees no other tenant's rows in the four scoped M2 tables", async () => {
    for (const [table, insert] of scopedInserts) {
      await unit(app, asTenant(tenantA), async () => app.query(insert, [tenantA]));
      const seen = async (settings: Settings): Promise<number | null> =>
        unit(
          app,
          settings,
          async () => (await app.query(`select 1 from fresh_ns.${table}`)).rowCount,
        );
      expect(await seen(asTenant(tenantA))).toBe(1);
      expect(await seen(asTenant(tenantB))).toBe(0);
      expect(await seen(asBackend)).toBe(0);
      expect(await seen(asNamespace)).toBe(1);
      await expect(
        unit(app, asTenant(tenantB), async () => app.query(insert, [tenantA])),
      ).rejects.toMatchObject({ code: '42501' });
    }
    const lease = `insert into fresh_ns.kw_consumer_leases values ('c', 'owner', now())`;
    await expect(unit(app, asTenant(tenantA), async () => app.query(lease))).rejects.toMatchObject({
      code: '42501',
    });
    await unit(app, asNamespace, async () => app.query(lease));
  });

  const controlInserts: readonly (readonly [string, string])[] = [
    [
      'kw_namespace_identities',
      `insert into kw__control.kw_namespace_identities values ('ns-a', 's', 't', now())`,
    ],
    [
      'kw_scope_marks',
      `insert into kw__control.kw_scope_marks values ('${tenantA}', 'ns-a', 1, '{}', 0, now())`,
    ],
    [
      'kw_leases',
      `insert into kw__control.kw_leases values ('k', null, 'key', 'holder', 1, now())`,
    ],
    [
      'kw_queue_pauses',
      `insert into kw__control.kw_queue_pauses values ('ns-a', 'q', null, '{}', 'r', now())`,
    ],
    [
      'kw_ledger',
      `insert into kw__control.kw_ledger (type, record, recorded_at) values ('t', '{}', now())`,
    ],
    [
      'kw_api_usage',
      `insert into kw__control.kw_api_usage values (current_date, '${deployment}', '${tenantA}', 'v1', 'rest', '', 1)`,
    ],
    [
      'kw_retention_runs',
      `insert into kw__control.kw_retention_runs values ('${deployment}', now(), now(), '${deployment}', null, '{}', '{}', '{}')`,
    ],
  ];

  test('control tables admit deployment units only', async () => {
    for (const [table, insert] of controlInserts) {
      for (const settings of [asTenant(tenantA), asBackend, asNamespace]) {
        await expect(unit(app, settings, async () => app.query(insert))).rejects.toMatchObject({
          code: '42501',
        });
      }
      await unit(app, asDeployment, async () => app.query(insert));
      const seen = async (settings: Settings): Promise<number | null> =>
        unit(
          app,
          settings,
          async () => (await app.query(`select 1 from kw__control.${table}`)).rowCount,
        );
      expect(await seen(asDeployment)).toBe(1);
      expect(await seen(asNamespace)).toBe(0);
    }
    for (const table of ['kw_ledger', 'kw_retention_runs']) {
      for (const text of [
        `update kw__control.${table} set run_id = run_id`,
        `delete from kw__control.${table}`,
      ]) {
        const statement =
          table === 'kw_ledger' ? text.replace('run_id = run_id', 'type = type') : text;
        await expect(
          unit(app, asDeployment, async () => app.query(statement)),
        ).rejects.toMatchObject({
          code: '42501',
        });
      }
    }
  });
});
