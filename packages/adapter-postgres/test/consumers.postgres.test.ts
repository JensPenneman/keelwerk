import type { StorageScope, Unit } from '@keelwerk/core';
import { keepIdleClients } from '@keelwerk/testing/postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { streamAppend } from './support/event-fixtures.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import { known } from './support/store-rows.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB, tenantA, tenantB } = testScopes;
let instance: PostgresAdapterInstance;
let adminUrl: string;

beforeAll(async () => {
  const database = await createTestDatabase('consumers_store');
  adminUrl = database.adminUrl;
  await prepareNamespaces(database.adminUrl);
  instance = postgresAdapter({
    ownerUrl: database.adminUrl,
    entities: (ref) => known.get(ref),
  }).create(
    {
      id: 'main',
      url: database.appUrl,
      strategy: 'shared-tables',
      pool: { max: 4, ...keepIdleClients },
    },
    testEnvironment(),
  ) as PostgresAdapterInstance;
  await instance.connect();
  // Provisioning applies framework step 0002, which holds the consumer tables.
  await instance.schema.provision(testNamespace, []);
  // A checkpoint cannot pass its scope's head (S-173): tenant A has twenty events to advance over.
  await instance.unit(testNamespace, scopeA, (unit) =>
    unit.events.append([
      streamAppend(
        1,
        Array.from({ length: 20 }, (_, index) => index + 1),
      ),
    ]),
  );
}, 120_000);

afterAll(async () => {
  await instance?.close(5000);
});

const run = <T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T> =>
  instance.unit(testNamespace, scope, fn);
const namespaceScope: StorageScope = { level: 'namespace', reason: 'test' };

/** Resolves once a backend is waiting for a lock, which is what the second unit's advance does. */
async function lockWaiting(): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await vi.waitFor(
      async () => {
        const { rows } = await client.query(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
        );
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 20 },
    );
  } finally {
    await client.end();
  }
}

describe('the consumer store under concurrency', () => {
  test('two units acquiring one lease at once: exactly one holds it', async () => {
    for (let round = 0; round < 10; round += 1) {
      const consumer = `test.lease-${round}`;
      const answers = await Promise.all(
        ['one', 'two', 'three'].map((owner) =>
          run(namespaceScope, (unit) => unit.consumers.acquireLease(consumer, owner, 60_000)),
        ),
      );
      expect(answers.filter(Boolean)).toHaveLength(1);
    }
  });

  test('concurrent advances of one checkpoint end at the greater position', async () => {
    const positions = [7n, 3n, 19n, 1n, 12n, 20n, 5n, 16n, 2n, 11n];
    await Promise.all(
      positions.map((to) => run(scopeA, (unit) => unit.consumers.advance('test.max', tenantA, to))),
    );
    expect(
      await run(namespaceScope, (unit) => unit.consumers.checkpoint('test.max', tenantA)),
    ).toBe(20n);
  });

  test("a second advance is refused as locked while the first's unit has not ended; after it, the first's advance stands and the row is free", async () => {
    await run(scopeA, (unit) => unit.consumers.advance('test.hold', tenantA, 3n));
    const gate = Promise.withResolvers<void>();
    const holding = Promise.withResolvers<void>();
    const first = run(scopeA, async (unit) => {
      await unit.consumers.advance('test.hold', tenantA, 5n);
      holding.resolve();
      await gate.promise;
    });
    try {
      await holding.promise;
      // The gate is shut: the first unit still holds the row, so the product's own lock wait ends the
      // second advance. Load can only make this slower; the gate opens after the answer.
      await expect(
        run(scopeA, (unit) => unit.consumers.advance('test.hold', tenantA, 9n)),
      ).rejects.toMatchObject({
        kind: 'unavailable',
        message: 'The checkpoint is locked by another unit.',
      });
    } finally {
      gate.resolve();
      await first;
    }
    // The first's advance stood and the refused one moved nothing; the row is free again now that the
    // first's unit has ended.
    expect(
      await run(namespaceScope, (unit) => unit.consumers.checkpoint('test.hold', tenantA)),
    ).toBe(5n);
    await run(scopeA, (unit) => unit.consumers.advance('test.hold', tenantA, 9n));
    expect(
      await run(namespaceScope, (unit) => unit.consumers.checkpoint('test.hold', tenantA)),
    ).toBe(9n);
  });

  test('two starts at once: the second answers false and gives no checkpoint to a scope whose first event committed in between', async () => {
    const consumer = 'test.two-starts';
    const written = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    const first = run(namespaceScope, async (unit) => {
      expect(await unit.consumers.startAtHeads(consumer)).toBe(true);
      written.resolve();
      await commit.promise;
    });
    await written.promise;
    // Tenant B's first event commits after the first start read the heads and before the second begins.
    await run(scopeB, (unit) => unit.events.append([streamAppend(2, [1])]));
    const second = run(namespaceScope, (unit) => unit.consumers.startAtHeads(consumer));
    // The second start waits for the first one's uncommitted start record; the first commits at once.
    await lockWaiting();
    commit.resolve();
    await first;
    expect(await second).toBe(false);
    const checkpoints = await run(namespaceScope, async (unit) => [
      await unit.consumers.checkpoint(consumer, tenantA),
      await unit.consumers.checkpoint(consumer, tenantB),
    ]);
    expect(checkpoints).toEqual([20n, null]);
  });
});
