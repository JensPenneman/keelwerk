import {
  applicationRoleDdl,
  commandReceiptDdl,
  frameworkSteps,
  frameworkTablesDdl,
  rlsPoliciesDdl,
} from '@keelwerk/data';
import pg from 'pg';
import { beforeAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from './support/create-test-database.ts';
import { id } from './support/store-rows.ts';
import { testScopes } from './support/test-scopes.ts';

const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');

describe('the function when the owner is an ordinary role', () => {
  const root = 'plain';
  const owner = 'kw_plain_owner';
  let adminUrl = '';
  let appUrl = '';
  let ownerUrl = '';

  const urlOf = (base: string, user: string, password: string): string => {
    const parsed = new URL(base);
    parsed.username = user;
    parsed.password = password;
    return parsed.toString();
  };

  /** One transaction as `url`'s role, with the settings of a unit. */
  async function transaction<T>(
    url: string,
    settings: Readonly<Record<string, string>>,
    work: (client: pg.Client) => Promise<T>,
  ): Promise<T> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('begin');
      for (const [name, value] of Object.entries(settings)) {
        await client.query('select set_config($1, $2, true)', [name, value]);
      }
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  const tenant = (tenantId: string) => ({ 'keelwerk.tenant_id': tenantId });

  const plant = (
    client: pg.Client,
    scope: string,
    stream: number,
    version: number,
    hours: number,
    transient: boolean,
  ) =>
    client.query(
      `insert into ${root}.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
         event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at, transient)
       values ($1::uuid, $2, $3::uuid, 'core.commandReceipt', $4::uuid, $5, $6::uuid, 'changed', 1, '\\x00', '{}', '{}', 'h', $7::timestamptz, $8)`,
      [
        scope,
        stream * 100 + version,
        testScopes.backendId,
        id(stream),
        version,
        id(900_000 + stream * 100 + version),
        stamp.add({ hours }).toString(),
        transient,
      ],
    );

  const purge = (
    settings: Readonly<Record<string, string>>,
    maxRows = 100,
    types: readonly string[] | null = ['core.commandReceipt'],
  ) =>
    transaction(appUrl, settings, async (client) => {
      const found = await client.query<{ removed: number; more: boolean }>(
        `select removed, more from ${root}.kw_purge_transient('2027-01-01T00:00:00Z'::timestamptz, $1::integer, $2::text[])`,
        [maxRows, types],
      );
      return found.rows[0];
    });

  const left = (scope: string) =>
    transaction(adminUrl, {}, async (client) => {
      const found = await client.query<{ version: number }>(
        `select stream_version as version from ${root}.kw_events where scope_id = $1::uuid order by stream_id, stream_version`,
        [scope],
      );
      return found.rows.map((row) => row.version);
    });

  beforeAll(async () => {
    const database = await createTestDatabase('purge_plain_owner');
    adminUrl = database.adminUrl;
    appUrl = database.appUrl;
    ownerUrl = urlOf(adminUrl, owner, owner);
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `create role ${owner} login password '${owner}' nosuperuser nobypassrls nocreaterole`,
      );
      // The framework statements create the schema, so the role needs the right to create one.
      await admin.query(`grant create, connect on database purge_plain_owner to ${owner}`);
    } finally {
      await admin.end();
    }
    // The root is made by the ordinary role: it owns the tables, the policies and the function.
    const fourth = frameworkSteps.find((step) => step.id === '0004');
    const statements = [
      ...frameworkTablesDdl(root),
      ...rlsPoliciesDdl(root),
      ...applicationRoleDdl(root, 'kw_app'),
      ...(fourth?.ddl(root, {}) ?? []),
      ...(fourth?.grants(root, 'kw_app', {}) ?? []),
    ];
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      for (const statement of statements) await client.query(statement);
    } finally {
      await client.end();
    }
    await transaction(appUrl, tenant(testScopes.tenantA), async (client) => {
      for (const version of [1, 2, 3])
        await plant(client, testScopes.tenantA, 1, version, version, true);
      await plant(client, testScopes.tenantA, 2, 1, 1, false);
      await plant(client, testScopes.tenantA, 2, 2, 2, true);
    });
    await transaction(appUrl, tenant(testScopes.tenantB), async (client) => {
      for (const version of [1, 2])
        await plant(client, testScopes.tenantB, 1, version, version, true);
    });
  }, 120_000);

  test('the owner is neither superuser nor bypassrls, and the tables force row-level security', async () => {
    const found = await transaction(adminUrl, {}, async (client) =>
      client.query<{ owner: string; super: boolean; bypass: boolean; forced: boolean }>(
        `select r.rolname as owner, r.rolsuper as super, r.rolbypassrls as bypass, c.relforcerowsecurity as forced
         from pg_proc p join pg_roles r on r.oid = p.proowner, pg_class c
         where p.proname = 'kw_purge_transient' and p.pronamespace = '${root}'::regnamespace
           and c.oid = '${root}.kw_events'::regclass`,
      ),
    );
    expect(found.rows[0]).toEqual({ owner, super: false, bypass: false, forced: true });
  });

  test("it removes the older transient records of the unit's scope only and keeps each stream's newest", async () => {
    expect(await purge(tenant(testScopes.tenantA))).toEqual({ removed: 2, more: false });
    // Stream 1 keeps version 3; stream 2 keeps its record that is not transient and its newest.
    expect(await left(testScopes.tenantA)).toEqual([3, 1, 2]);
    expect(await left(testScopes.tenantB)).toEqual([1, 2]);
    expect(await purge(tenant(testScopes.tenantB), 1)).toEqual({ removed: 1, more: false });
    expect(await left(testScopes.tenantB)).toEqual([2]);
  });

  test('an unlisted type is refused and an empty list is left alone', async () => {
    await expect(purge(tenant(testScopes.tenantA), 100, ['app.other'])).rejects.toMatchObject({
      code: '42501',
    });
    expect(await purge(tenant(testScopes.tenantA), 100, [])).toEqual({ removed: 0, more: false });
  });

  test('a namespace-scope unit removes nothing, a direct delete is refused and the limits hold', async () => {
    const marker = { 'keelwerk.scope': 'namespace' };
    await expect(purge(marker)).rejects.toMatchObject({ code: '42501' });
    await expect(purge({})).rejects.toMatchObject({ code: '42501' });
    await expect(purge(tenant(testScopes.tenantA), 0)).rejects.toMatchObject({ code: '22023' });
    await expect(purge(tenant(testScopes.tenantA), 100_001)).rejects.toMatchObject({
      code: '22023',
    });
    await expect(purge(tenant(testScopes.tenantA), 10, null)).rejects.toMatchObject({
      code: '22023',
    });
    await expect(
      transaction(appUrl, tenant(testScopes.tenantA), async (client) =>
        client.query(`delete from ${root}.kw_events where transient`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('with a receipt table the ordinary owner reads it under forced policies: a live receipt keeps its newest record, a gone one loses it', async () => {
    // The receipt table is made by the ordinary owner too and the application role may write it.
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      for (const statement of commandReceiptDdl(root)) await client.query(statement);
      await client.query(
        `grant select, insert, update, delete on ${root}.core__command_receipt to kw_app`,
      );
    } finally {
      await client.end();
    }
    const tenantA = testScopes.tenantA;
    await transaction(appUrl, tenant(tenantA), async (client) => {
      // A receipt row of stream 5 only: its other columns take whatever their type needs.
      const columns = await client.query<{ name: string; type: string }>(
        `select column_name as name, data_type as type from information_schema.columns
         where table_schema = '${root}' and table_name = 'core__command_receipt'
           and is_nullable = 'NO' and column_default is null and column_name not in ('scope_id', 'id')`,
      );
      const values: Record<string, string> = {
        uuid: 'gen_random_uuid()',
        text: `'x'`,
        'timestamp with time zone': 'now()',
        integer: '1',
        bigint: '1',
        jsonb: `'{}'::jsonb`,
        boolean: 'false',
      };
      const names = ['scope_id', 'id', ...columns.rows.map((row) => row.name)];
      const given = [
        `'${tenantA}'::uuid`,
        `'${id(5)}'::uuid`,
        ...columns.rows.map((row) =>
          row.name === 'status' ? `'completed'` : (values[row.type] ?? `'x'`),
        ),
      ];
      await client.query(
        `insert into ${root}.core__command_receipt (${names.join(', ')}) values (${given.join(', ')})`,
      );
      for (const stream of [5, 6]) {
        for (const version of [1, 2]) await plant(client, tenantA, stream, version, version, true);
      }
    });
    // Five go: stream 5's first record, both of stream 6, and the records that earlier tests left
    // as the newest of streams 1 and 2, whose receipts do not exist. Stream 5 keeps its newest.
    expect(await purge(tenant(tenantA))).toEqual({ removed: 5, more: false });
    const rest = await transaction(adminUrl, {}, async (client) =>
      client.query<{ stream: string; version: number }>(
        `select stream_id::text as stream, stream_version as version from ${root}.kw_events
         where stream_id in ('${id(5)}', '${id(6)}') order by 1, 2`,
      ),
    );
    expect(rest.rows).toEqual([{ stream: id(5), version: 2 }]);
  });
});
