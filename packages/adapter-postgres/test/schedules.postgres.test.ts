import type { StorageScope, Unit } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import { known } from './support/store-rows.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB, tenantA, tenantB } = testScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'test' };
const T0 = Temporal.Instant.from('2026-01-01T00:00:00Z');
const at = (minutes: number): Temporal.Instant => T0.add({ minutes });
const schedule = 'ticker.everyTenant';
let instance: PostgresAdapterInstance;
let second: PostgresAdapterInstance;

const open = (url: string, ownerUrl: string): PostgresAdapterInstance =>
  postgresAdapter({ ownerUrl, entities: (ref) => known.get(ref) }).create(
    { id: 'main', url, strategy: 'shared-tables', pool: { max: 4 } },
    testEnvironment(),
  ) as PostgresAdapterInstance;

beforeAll(async () => {
  const database = await createTestDatabase('schedules_store');
  await prepareNamespaces(database.adminUrl);
  instance = open(database.appUrl, database.adminUrl);
  await instance.connect();
  // Provisioning applies framework step 0002, which holds kw_schedules.
  await instance.schema.provision(testNamespace, []);
  // A second connection pool on the same database: a second process.
  second = open(database.appUrl, database.adminUrl);
  await second.connect();
}, 120_000);

afterAll(async () => {
  await instance?.close(5000);
  await second?.close(5000);
});

const run = <T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T> =>
  instance.unit(testNamespace, scope, fn);

describe('the schedule store on PostgreSQL', () => {
  test('two connections claim one tick: one wins', { timeout: 60_000 }, async () => {
    await run(scopeA, (unit) => unit.jobs.schedules().upsert(schedule, at(5)));
    const claims = await Promise.all(
      [instance, second].map((adapter) =>
        adapter.unit(testNamespace, scopeA, (unit) =>
          unit.jobs.schedules().claimTick(schedule, tenantA, at(5), at(10)),
        ),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const [row] = await run(namespaceScope, (unit) => unit.jobs.schedules().due(at(10), 10));
    expect(row).toMatchObject({ scopeId: tenantA, lastTick: at(5), nextTick: at(10) });
  });

  test('a tenant unit reads only its own rows under row-level security', {
    timeout: 60_000,
  }, async () => {
    await run(scopeA, (unit) => unit.jobs.schedules().upsert('ticker.other', at(1)));
    await run(scopeB, (unit) => unit.jobs.schedules().upsert('ticker.other', at(1)));
    const own = await run(scopeB, (unit) => unit.jobs.schedules().due(at(60), 100));
    expect(own.map((row) => row.scopeId)).toEqual([tenantB]);
    // The unit may name no other scope, and the table's policy would hide it anyway.
    await expect(
      run(scopeB, (unit) => unit.jobs.schedules().claimTick('ticker.other', tenantA, at(1), at(2))),
    ).rejects.toMatchObject({ code: 'core.forbidden' });
  });

  test('a namespace unit reads and claims every scope', { timeout: 60_000 }, async () => {
    const all = await run(namespaceScope, (unit) => unit.jobs.schedules().due(at(60), 100));
    expect(new Set(all.map((row) => row.scopeId))).toEqual(new Set([tenantA, tenantB]));
    expect(
      await run(namespaceScope, (unit) =>
        unit.jobs.schedules().claimTick('ticker.other', tenantB, at(1), at(61)),
      ),
    ).toBe(true);
    const after = await run(scopeB, (unit) => unit.jobs.schedules().due(at(60), 100));
    expect(after).toEqual([]);
  });
});
