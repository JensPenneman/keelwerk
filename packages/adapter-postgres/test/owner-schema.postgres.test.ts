import type { EntityEntry, NamespaceRef } from '@keelwerk/core';
import { buildTrackSnapshot } from '@keelwerk/data';
import { conformanceApp } from '@keelwerk/testing/fixtures';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import type { TestDatabase } from './support/test-database.ts';
import { testEnvironment } from './support/test-environment.ts';

const namespace: NamespaceRef = {
  id: 'owner-test',
  placementId: 'main',
  appId: 'conformance',
  tenantId: null,
  root: 'owner_test',
};

/** The registry does not record conditional fields: `loans[library]` adds `bookId`. */
function trackOfField(entry: EntityEntry, field: string): string {
  const own = entry.tracks[0]?.track ?? entry.module;
  if (entry.ref === 'loans.loan' && field === 'bookId') return 'loans[library]';
  const contributor = entry.origin[field];
  if (contributor === undefined) return own;
  return entry.tracks.find((track) => track.contributedBy === contributor)?.track ?? own;
}

const snapshots = [
  ...buildTrackSnapshot([...conformanceApp.registry.entities.values()], { trackOfField }).values(),
];

let running: TestDatabase;
let instance: PostgresAdapterInstance;

beforeAll(async () => {
  running = await createTestDatabase('owner_schema');
  const factory = postgresAdapter({ ownerUrl: running.adminUrl });
  instance = factory.create(
    { id: 'main', url: running.appUrl, strategy: 'shared-tables', pool: { max: 2 } },
    testEnvironment(),
  ) as PostgresAdapterInstance;
});

afterAll(async () => {
  await instance?.close(5000);
});

async function asApplicationRole<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: running.appUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test('the owner provisions the snapshots and the application role cannot switch row-level security off', async () => {
  await instance.schema.provision(namespace, snapshots);
  const tables = (await instance.schema.introspect({ namespace })).tables.map(
    (table) => table.name,
  );
  expect(tables.length).toBeGreaterThan(0);
  const target = tables.find((name) => name.startsWith('library__'));
  if (target === undefined) throw new Error('no library table was created');
  await expect(
    asApplicationRole((client) =>
      client.query(`alter table ${namespace.root}.${target} no force row level security`),
    ),
  ).rejects.toThrow();
  await expect(
    asApplicationRole((client) =>
      client.query(`alter table ${namespace.root}.${target} disable row level security`),
    ),
  ).rejects.toThrow();
});

test('a second provision is idempotent', async () => {
  const before = await instance.schema.introspect({ namespace });
  await instance.schema.provision(namespace, snapshots);
  expect(await instance.schema.introspect({ namespace })).toEqual(before);
});
