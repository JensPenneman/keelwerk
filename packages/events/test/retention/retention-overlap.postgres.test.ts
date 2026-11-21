import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { transientPurgeTypes } from '@keelwerk/core';
import { startPostgres } from '@keelwerk/testing/postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { purgeExpiredReceipts } from '../../src/retention/purge-expired-receipts.ts';
import { bootRetention, type RetentionKit } from './support/retention-kit.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let postgres: Awaited<ReturnType<typeof startPostgres>>;
let kit: RetentionKit;

beforeAll(async () => {
  postgres = await startPostgres();
  kit = await bootRetention('memory', { batchSize: 10 }, ['acme', 'globex'], {
    factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
    url: postgres.appUrl,
  });
}, 180_000);

afterAll(async () => {
  await kit?.runtime.stop();
  await postgres?.stop();
});

/** Waits until a backend waits for a row lock: a purge that stands behind another purge's deletes. */
async function untilSomeoneWaits(): Promise<void> {
  const client = new pg.Client({ connectionString: postgres.adminUrl });
  await client.connect();
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = await client.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock'`,
      );
      if ((found.rows[0]?.n ?? 0) > 0) return;
      await pause(50);
    }
  } finally {
    await client.end();
  }
  throw new Error('no purge came to wait for the rows of the other');
}

test('a pass that skipped records another pass took claims no horizon while candidates are left', async () => {
  const stream = crypto.randomUUID();
  // 24 candidates and the newest record, which stays; batches of 10.
  await kit.plantEvents(
    'acme',
    stream,
    Array.from({ length: 25 }, () => ({ ageHours: 400, kind: 'transient' as const })),
  );
  const deleted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const now = kit.runtime.clock.now();
  // The other pass has deleted the oldest five and not committed yet.
  const other = kit.inTenant('acme', async (unit) => {
    await unit.events.purgeTransient(now, 5, transientPurgeTypes);
    deleted.resolve();
    await release.promise;
  });
  await deleted.promise;
  const pass = kit.pass();
  await untilSomeoneWaits();
  release.resolve();
  await other;
  const runs = await pass;
  const acme = runs.find((run) => run.tenantId === kit.runtime.tenants.acme.id);
  // Its first batch of ten skipped the five the other pass took and removed five: short, with
  // fourteen candidates left. A horizon is a claim that none are left, so the pass has to go on.
  const left = (await kit.versionsOf('acme', stream)).length - 1;
  expect(left).toBe(0);
  expect(acme?.removed.transientRecords).toBe(19);
  expect(acme?.horizons.transientRecords).toBeDefined();
});

test('a pass that waits on receipts another pass deleted purges the rest and claims the horizon', async () => {
  const past = kit.runtime.clock.now().subtract({ hours: 2 });
  const receipts = Array.from({ length: 15 }, () => crypto.randomUUID());
  for (const commandId of receipts) await kit.plantReceipt('acme', commandId, 'completed', past);
  const source = kit
    .context()
    .namespaces.find((entry) => entry.namespace.id === kit.runtime.namespace.id);
  if (source === undefined) throw new Error('the data namespace is not served');
  const deleted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const now = kit.runtime.clock.now();
  // The other unit has purged the oldest five and not committed yet.
  const other = kit.inTenant('acme', async (unit) => {
    await purgeExpiredReceipts(unit, source.registry, now, 5);
    deleted.resolve();
    await release.promise;
  });
  await deleted.promise;
  // Its first batch of ten waits for the rows the held unit locked.
  const pass = kit.pass();
  await untilSomeoneWaits();
  release.resolve();
  await other;
  const runs = await pass;
  const acme = runs.find((run) => run.tenantId === kit.runtime.tenants.acme.id);
  for (const commandId of receipts) expect(await kit.receiptOf('acme', commandId)).toBeUndefined();
  expect(acme?.removed.receipts).toBe(10);
  expect(acme?.horizons.receipts).toBeDefined();
});
