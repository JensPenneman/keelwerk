import type { StorageScope } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  applyPending,
  columnType,
  compareCatalogue,
  migrationChecksum,
  samePredicate,
} from '../../src/index.ts';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { runStatement } from '../support/run-statement.ts';
import { conformanceSnapshots } from './support/conformance-snapshots.ts';
import { migratingPglite } from './support/migrating-pglite.ts';
import { migrationNamespace } from './support/migration-namespace.ts';
import { planAllTracks } from './support/plan-all-tracks.ts';

const tenantScope = (tenantId: string): StorageScope => ({
  level: 'tenant',
  backendId: '00000000-0000-4000-8000-0000000000bb',
  tenantId,
});

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await migratingPglite();
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

describe('a planned migration applied on PGlite', () => {
  test('applies every track in order and records it', async () => {
    const tracks = await planAllTracks(conformanceSnapshots);
    const warnings: string[] = [];
    const result = await applyPending(adapter.schema, migrationNamespace, tracks, {
      warn: (message) => warnings.push(message),
    });
    expect(result.deferred).toEqual([]);
    expect(result.applied.map((file) => file.track)).toEqual(tracks.map((entry) => entry.track));
    expect(warnings).toEqual([]);
    const history = await adapter.schema.history(migrationNamespace);
    expect(history.map((row) => `${row.track} ${row.id}`).sort()).toEqual(
      tracks.map((entry) => `${entry.track} 0001-initial`).sort(),
    );
    for (const row of history) {
      const file = tracks.find((entry) => entry.track === row.track)?.files[0];
      expect(row.checksum).toBe(migrationChecksum(file?.steps ?? []));
      expect(row.appliedAt).toBeInstanceOf(Temporal.Instant);
    }
  });

  test('introspected back, the catalogue equals the snapshots', async () => {
    const live = await adapter.schema.introspect({ namespace: migrationNamespace });
    const dialect = { typeOf: columnType, samePredicate };
    expect(live.tables.map((table) => table.name)).toContain('loans__loan');
    expect(compareCatalogue([...conformanceSnapshots.values()], live, dialect)).toEqual([]);
  });

  test('applying again changes nothing', async () => {
    const tracks = await planAllTracks(conformanceSnapshots);
    const result = await applyPending(adapter.schema, migrationNamespace, tracks);
    expect(result.applied).toEqual([]);
  });

  test('every new table has forced row-level security and its policies', async () => {
    const rows = await adapter.asOwner(async (database) =>
      database.query<{ relname: string; force: boolean; policies: string }>(
        `select c.relname, c.relforcerowsecurity as force,
           coalesce((select string_agg(policyname, ',' order by policyname) from pg_policies p
             where p.schemaname = n.nspname and p.tablename = c.relname), '') as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1 and c.relkind = 'r' and c.relname not like 'kw\\_%'
         order by c.relname`,
        [migrationNamespace.root],
      ),
    );
    expect(rows.rows.map((row) => row.relname)).toContain('library__book');
    for (const row of rows.rows) {
      expect(row.force, row.relname).toBe(true);
      expect(row.policies, row.relname).toBe('maintenance,scoped');
    }
  });

  test('the tenant policy hides a book from another tenant', async () => {
    const tenantA = '00000000-0000-4000-8000-0000000000a1';
    const tenantB = '00000000-0000-4000-8000-0000000000b1';
    const book = `${migrationNamespace.root}.library__book`;
    await adapter.unit(migrationNamespace, tenantScope(tenantA), async (unit) =>
      runStatement(
        unit,
        `insert into ${book} (tenant_id, id, title, isbn, added_by) values ($1, $2, 'T', '978', 'x')`,
        [tenantA, '00000000-0000-4000-8000-000000000001'],
      ),
    );
    const count = async (tenantId: string): Promise<number> =>
      adapter.unit(migrationNamespace, tenantScope(tenantId), async (unit) => {
        const result = await runStatement(unit, `select 1 from ${book}`);
        return result.rows.length;
      });
    expect(await count(tenantA)).toBe(1);
    expect(await count(tenantB)).toBe(0);
  });

  test('a duplicate isbn among live books is refused, an archived one is not', async () => {
    const tenantA = '00000000-0000-4000-8000-0000000000a1';
    const book = `${migrationNamespace.root}.library__book`;
    const insert = `insert into ${book} (tenant_id, id, title, isbn, added_by, archived_at)
      values ($1, $2, 'T', '978', 'x', $3)`;
    await expect(
      adapter.unit(migrationNamespace, tenantScope(tenantA), async (unit) =>
        runStatement(unit, insert, [tenantA, '00000000-0000-4000-8000-000000000002', null]),
      ),
    ).rejects.toMatchObject({ code: 'core.conflict' });
    await adapter.unit(migrationNamespace, tenantScope(tenantA), async (unit) =>
      runStatement(unit, insert, [tenantA, '00000000-0000-4000-8000-000000000003', new Date()]),
    );
  });
});
