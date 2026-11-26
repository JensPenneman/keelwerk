import { afterEach, expect, test } from 'vitest';
import { frameworkTrack } from '../src/index.ts';
import { type PgliteAdapter, pgliteSchemaConnection } from '../src/pglite/index.ts';
import { withCommandReceipts } from '../src/sql/postgres/with-command-receipts.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { storeControlNamespace } from './support/store-control-namespace.ts';

/** Provisioning as the adapter runs it: the framework steps, then the receipt table when it is absent. */
const provision = async (adapter: PgliteAdapter, ref: typeof exampleNamespace): Promise<void> =>
  withCommandReceipts(adapter.schema, pgliteSchemaConnection(adapter.asOwner), 'kw_app').provision(
    ref,
    [],
  );

const opened: PgliteAdapter[] = [];
const roots = [
  [exampleNamespace, 'example'],
  [storeControlNamespace, 'kw__control'],
] as const;
const namespaceUnit = `current_setting('keelwerk.scope', true) = 'namespace'`;

afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
});

const rowsOf = async (adapter: PgliteAdapter, sql: string) =>
  adapter.asOwner(async (database) => (await database.query<Record<string, unknown>>(sql)).rows);

const policiesOf = async (adapter: PgliteAdapter, root: string) =>
  rowsOf(
    adapter,
    `select policyname as name, cmd from pg_policies where schemaname = '${root}' and tablename = 'core__command_receipt' order by policyname`,
  );

const newPolicies = [
  { name: 'maintenance_delete', cmd: 'DELETE' },
  { name: 'maintenance_select', cmd: 'SELECT' },
  { name: 'scoped', cmd: 'ALL' },
];

test('a fresh root gets the receipt table with the select and delete policies', async () => {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  for (const [ref] of roots) await provision(adapter, ref);
  for (const [, root] of roots) expect(await policiesOf(adapter, root)).toEqual(newPolicies);
});

test('a root made by 0.2.0 keeps its receipt rows and loses the insert and update of a maintenance unit when step 0006 runs', async () => {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  for (const [ref] of roots) await provision(adapter, ref);
  // The root as 0.2.0 left it: one `maintenance` policy for every command, and no row for step 0006.
  for (const [, root] of roots) {
    const table = `"${root}".core__command_receipt`;
    await adapter.asOwner(async (database) => {
      await database.exec(`
        drop policy maintenance_select on ${table};
        drop policy maintenance_delete on ${table};
        create policy maintenance on ${table} using (${namespaceUnit}) with check (${namespaceUnit});
        delete from "${root}".kw_migrations where track = '${frameworkTrack}' and id = '0006';
        insert into ${table} (scope_id, id, command_id, action, fingerprint, status, api_version, transport, expires_at)
          values (gen_random_uuid(), gen_random_uuid(), 'c1', 'app.note.set', 'f1', 'pending', '2026-01-01', 'rest', now())`);
    });
    expect((await policiesOf(adapter, root)).map((row) => row.name)).toEqual([
      'maintenance',
      'scoped',
    ]);
  }
  for (const [ref] of roots) await provision(adapter, ref);
  for (const [ref, root] of roots) {
    expect(await policiesOf(adapter, root)).toEqual(newPolicies);
    expect(
      await rowsOf(
        adapter,
        `select command_id as "commandId" from "${root}".core__command_receipt`,
      ),
    ).toEqual([{ commandId: 'c1' }]);
    const history = await adapter.schema.history(ref);
    expect(history.filter((row) => row.track === frameworkTrack).map((row) => row.id)).toContain(
      '0006',
    );
  }
});

test('step 0006 on a root that has no receipt table changes nothing and a second run ends in the same state', async () => {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  for (const [ref] of roots) await provision(adapter, ref);
  for (const [, root] of roots) {
    await adapter.asOwner(async (database) => {
      await database.exec(
        `delete from "${root}".kw_migrations where track = '${frameworkTrack}' and id = '0006'`,
      );
    });
  }
  // The history lost its row for 0006: the step runs again over the finished policies.
  for (const [ref, root] of roots) {
    await provision(adapter, ref);
    expect(await policiesOf(adapter, root)).toEqual(newPolicies);
  }
  await adapter.asOwner(async (database) => {
    await database.exec(`
      drop table "example".core__command_receipt;
      delete from "example".kw_migrations where track = '${frameworkTrack}' and id = '0006'`);
  });
  // The step met no table (it throws nothing); provisioning then creates the table with the two policies.
  await provision(adapter, exampleNamespace);
  expect(await policiesOf(adapter, 'example')).toEqual(newPolicies);
});
