import type { NamespaceRef, Receipt } from '@keelwerk/core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import { prepareStoreTables } from './support/prepare-store-tables.ts';
import type { TestDatabase } from './support/test-database.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const pinned = Temporal.Instant.from('2020-01-01T00:00:00Z');

const namespace: NamespaceRef = {
  id: 'pinned-clock',
  placementId: 'main',
  appId: 'conformance',
  tenantId: null,
  root: 'pinned_clock',
};

let running: TestDatabase;
let instance: PostgresAdapterInstance;

beforeAll(async () => {
  running = await createTestDatabase('pinned_clock');
  await prepareNamespaces(running.adminUrl);
  await prepareStoreTables(running.adminUrl);
  // No `clock` option: the only clock the adapter can use is the one of the environment.
  instance = postgresAdapter({ ownerUrl: running.adminUrl }).create(
    { id: 'main', url: running.appUrl, strategy: 'shared-tables', pool: { max: 2 } },
    { ...testEnvironment(), clock: { now: () => pinned } },
  ) as PostgresAdapterInstance;
  await instance.connect();
});

afterAll(async () => {
  await instance?.close(5000);
});

const receipt: Receipt = {
  commandId: 'pinned',
  action: 'app.ticket.set',
  fingerprint: 'f1',
  principal: null,
  principalResolver: null,
  principalId: null,
  status: 'pending',
  outcome: null,
  apiVersion: '2026-01-01',
  request: { transport: 'rest', remoteAddress: null, userAgent: null },
  clientId: null,
  clientSeq: null,
  expiresAt: pinned.add({ hours: 24 }),
};

test('a receipt that expires a day after the environment clock is still live under the real date', async () => {
  const claim = () =>
    instance.unit(testNamespace, testScopes.scopeA, (u) => u.receipts.claim(receipt));
  expect(await claim()).toBe('inserted');
  expect(await claim()).toBe('exists');
});

test('an applied migration is recorded at the environment clock, not the database time', async () => {
  await instance.schema.provision(namespace, []);
  await instance.schema.apply(namespace, { id: '0001-pinned', track: 'app', steps: [] });
  const history = await instance.schema.history(namespace);
  expect(new Set(history.map((entry) => entry.appliedAt.toString()))).toEqual(
    new Set([pinned.toString()]),
  );
});
