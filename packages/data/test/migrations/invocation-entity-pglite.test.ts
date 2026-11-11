import type { StorageScope } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  applyPending,
  buildTrackSnapshot,
  columnType,
  compareCatalogue,
  planTrack,
  samePredicate,
} from '../../src/index.ts';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { runStatement } from '../support/run-statement.ts';
import { invocationEntry } from './support/invocation-entry.ts';
import { migratingPglite } from './support/migrating-pglite.ts';
import { migrationNamespace } from './support/migration-namespace.ts';
import { noRename } from './support/no-rename.ts';

const backendId = '00000000-0000-4000-8000-0000000000bb';
const tenantA = '00000000-0000-4000-8000-0000000000a1';
const tenantB = '00000000-0000-4000-8000-0000000000b1';
const asTenant = (tenantId: string): StorageScope => ({ level: 'tenant', backendId, tenantId });
const asBackend: StorageScope = { level: 'backend', backendId };
const asNamespace: StorageScope = { level: 'namespace', reason: 'test' };
const table = `${migrationNamespace.root}.notes__stamp`;
const snapshots = buildTrackSnapshot([invocationEntry()]);

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await migratingPglite();
  const desired = snapshots.get('notes');
  if (desired === undefined) throw new Error('no notes track');
  const plan = await planTrack({ previous: null, desired, name: 'initial', ask: noRename });
  await applyPending(adapter.schema, migrationNamespace, [
    { track: 'notes', files: plan?.files ?? [] },
  ]);
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

const insert = (scope: StorageScope, scopeId: string, id: string, token: string) =>
  adapter.unit(migrationNamespace, scope, (unit) =>
    runStatement(
      unit,
      `insert into ${table} (scope_id, id, created_at, updated_at, token, seen_at) values ($1, $2, now(), now(), $3, now())`,
      [scopeId, id, token],
    ),
  );
const count = (scope: StorageScope): Promise<number> =>
  adapter.unit(
    migrationNamespace,
    scope,
    async (unit) => (await runStatement(unit, `select 1 from ${table}`)).rows.length,
  );

describe('an invocation entity of a module on PGlite', () => {
  test('a tenant writes its rows; another tenant and its own backend read none', async () => {
    await insert(asTenant(tenantA), tenantA, '00000000-0000-4000-8000-000000000001', 'a');
    expect(await count(asTenant(tenantA))).toBe(1);
    expect(await count(asTenant(tenantB))).toBe(0);
    expect(await count(asBackend)).toBe(0);
  });

  test('a tenant cannot write a row of another scope', async () => {
    await expect(
      insert(asTenant(tenantB), tenantA, '00000000-0000-4000-8000-000000000009', 'x'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('the backend writes its rows; a tenant of it reads none of them', async () => {
    await insert(asBackend, backendId, '00000000-0000-4000-8000-000000000002', 'b');
    expect(await count(asBackend)).toBe(1);
    expect(await count(asTenant(tenantA))).toBe(1);
    expect(await count(asTenant(tenantB))).toBe(0);
  });

  test('a namespace unit reads every row and can update them (maintenance is every command)', async () => {
    expect(await count(asNamespace)).toBe(2);
    const updated = await adapter.unit(migrationNamespace, asNamespace, (unit) =>
      runStatement(unit, `update ${table} set version = version + 1 returning id`),
    );
    expect(updated.rows).toHaveLength(2);
  });

  test('introspected back, the catalogue equals the snapshot', async () => {
    const live = await adapter.schema.introspect({ namespace: migrationNamespace });
    expect(live.tables.find((candidate) => candidate.name === 'notes__stamp')?.scoped).toBe(
      'tenant',
    );
    expect(
      compareCatalogue([...snapshots.values()], live, { typeOf: columnType, samePredicate }),
    ).toEqual([]);
  });
});
