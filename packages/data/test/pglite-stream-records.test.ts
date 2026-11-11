import { afterEach, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { fixedInstant } from './support/fixed-instant.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { provisionExampleRoots } from './support/provision-example-roots.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

const opened: PgliteAdapter[] = [];

async function open(): Promise<PgliteAdapter> {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  await provisionExampleRoots(adapter);
  return adapter;
}

afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
});

const rowsOf = (adapter: PgliteAdapter, text: string) =>
  adapter.asOwner(async (database) => (await database.query<Record<string, unknown>>(text)).rows);

describe('the stream record table on PGlite', () => {
  test('data holds the record under the one member record', async () => {
    const adapter = await open();
    await adapter.unit(exampleNamespace, storageTenant(tenantA), (u) =>
      u.streams.append('conf.log', 'k', [{ line: 'a' }]),
    );
    const rows = await rowsOf(adapter, 'select data from example.kw_stream_records');
    expect(rows).toEqual([{ data: { record: { line: 'a' } } }]);
  });

  test('seq is drawn from the kw_serials row stream:<stream>, seq, canonical JSON of the key', async () => {
    const adapter = await open();
    await adapter.unit(exampleNamespace, storageTenant(tenantA), async (u) => {
      await u.streams.append('conf.log', 'k', [{ n: 1 }, { n: 2 }]);
      await u.streams.append('conf.log', 'k', [{ n: 3 }]);
    });
    expect(
      await rowsOf(adapter, 'select seq::text as seq from example.kw_stream_records order by seq'),
    ).toEqual([{ seq: '1' }, { seq: '2' }, { seq: '3' }]);
    expect(
      await rowsOf(
        adapter,
        'select entity, field, partition, next::text as next from example.kw_serials',
      ),
    ).toEqual([{ entity: 'stream:conf.log', field: 'seq', partition: '["k"]', next: '4' }]);
  });

  test("at is the adapter clock's instant, never the database's", async () => {
    const adapter = await open();
    await adapter.unit(exampleNamespace, storageTenant(tenantA), (u) =>
      u.streams.append('conf.log', 'k', [{ line: 'a' }]),
    );
    const rows = await rowsOf(
      adapter,
      `select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from example.kw_stream_records`,
    );
    expect(rows).toEqual([{ at: fixedInstant.toString({ fractionalSecondDigits: 3 }) }]);
  });

  test('a record stored without the record member is refused as internal on read', async () => {
    const adapter = await open();
    await adapter.unit(exampleNamespace, storageTenant(tenantA), (u) =>
      u.streams.append('conf.log', 'k', [{ line: 'a' }]),
    );
    await adapter.asOwner(async (database) =>
      database.query(`update example.kw_stream_records set data = '{"offload": {}}'::jsonb`),
    );
    await expect(
      adapter.unit(exampleNamespace, storageTenant(tenantA), (u) =>
        u.streams.read('conf.log', 'k', null, 10),
      ),
    ).rejects.toMatchObject({ kind: 'internal' });
  });
});
