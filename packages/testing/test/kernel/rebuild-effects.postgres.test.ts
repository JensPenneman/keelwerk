import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { entityBehavioursOf } from '@keelwerk/core';
import { rebuildFromChain } from '@keelwerk/core/replay';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TestDatabase } from '../support/test-database.ts';
import { type HookEndpoint, startHookEndpoint } from './support/hook-endpoint.ts';
import { type BootedHooks, bootHooks } from './support/hooks-kit.ts';
import { drainHooks } from './support/hooks-reads.ts';
import { rowsAsText } from './support/rows-as-text.ts';

let urls: TestDatabase;
let endpoint: HookEndpoint;
const running: BootedHooks[] = [];

beforeAll(async () => {
  urls = await createTestDatabase('rebuild_effects');
  endpoint = await startHookEndpoint();
}, 120_000);
afterAll(async () => {
  await Promise.allSettled(running.splice(0).map((booted) => booted.runtime.stop(0)));
  await endpoint.close();
});

const start = async (
  options: {
    join?: { backendId: string; tenants: Record<string, string> };
    serveOnly?: boolean;
  },
  database: TestDatabase = urls,
) => {
  const booted = await bootHooks({
    adapter: 'memory',
    endpoint: endpoint.url,
    external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
    ...options,
  });
  running.push(booted);
  return booted;
};

/** The rows of an entity through the sealing layer, as the kernel reads them. */
async function sealedRows(booted: BootedHooks, entity: string) {
  const entry = booted.runtime.app.registry.entities.get(entity);
  if (entry === undefined) throw new Error(`no entity ${entity}`);
  const { runtime, scope } = booted;
  return runtime.sealed.unit(
    runtime.namespace,
    scope,
    async (unit) => (await unit.rows.find(entry.descriptor, {})).rows,
  );
}

test('after the M2-4 scenario a rebuild from the chain reproduces the state rows and the effect states, and an effect left unsettled is enqueued again and settles once (exit criterion 10, second half)', {
  timeout: 300_000,
}, async () => {
  // Runtime A, with workers on a fresh database: one notification, delivered.
  const first = await start({});
  await first.client.invoke('hooks.notify', { payload: 'first' });
  await drainHooks(first);
  const [settled] = await sealedRows(first, 'core.effect');
  expect(settled).toMatchObject({ type: 'hooks.post', status: 'succeeded' });
  const ids = {
    backendId: first.runtime.backendId,
    tenants: { acme: first.runtime.tenants.acme.id },
  };
  await first.runtime.stop(1000);

  // Runtime B only requests: the second effect is left requested, its job never taken.
  const second = await start({ join: ids, serveOnly: true });
  await second.client.invoke('hooks.notify', { payload: 'second' });
  const effects = await sealedRows(second, 'core.effect');
  expect(effects.map((row) => row.status).sort()).toEqual(['requested', 'succeeded']);
  const registry = second.runtime.app.registry;
  // The entities a tenant rebuild folds: core.effect is an invocation entity that lives in the
  // tenant. Its table comes first, so that it is deleted before the tables it may refer to.
  const chain = [...registry.entities.values()]
    .filter(
      (entry) =>
        entry.descriptor.history === 'chain' &&
        (entry.descriptor.tenancy === 'tenant' || entry.descriptor.tenancy === 'invocation'),
    )
    .sort((a, b) => Number(b.ref === 'core.effect') - Number(a.ref === 'core.effect'));
  expect(chain.map((entry) => entry.ref)).toContain('core.effect');
  const snapshot = new Map<string, readonly string[]>();
  for (const entry of chain)
    snapshot.set(entry.ref, rowsAsText(await sealedRows(second, entry.ref)));
  const receipts = registry.entities.get('core.commandReceipt')?.descriptor.table;
  const schema = second.runtime.namespace.root;
  await second.runtime.stop(1000);

  // Everything the rebuild brings back is gone: the chain entity tables, the receipts and the jobs.
  const admin = new pg.Client({ connectionString: urls.adminUrl });
  await admin.connect();
  try {
    const tables = [
      ...chain.map((entry) => entry.descriptor.table),
      ...(receipts === undefined ? [] : [receipts]),
      'kw_jobs',
    ];
    await admin.query(
      `begin; set local keelwerk.scope = 'namespace'; ${tables.map((table) => `delete from "${schema}"."${table}";`).join(' ')} commit;`,
    );
  } finally {
    await admin.end();
  }

  // Runtime C, with workers: the rebuild folds the rows back and enqueues the second effect once.
  const third = await start({ join: ids });
  const report = await third.runtime.rebuild();
  for (const entity of ['hooks.delivery', 'core.effect']) {
    expect(report.entities.find((one) => one.entity === entity)).toMatchObject({
      streams: 2,
      inserted: 2,
      updated: 0,
      purged: 0,
    });
  }
  expect(report.entities.at(-1)?.entity).toBe('core.effect');
  expect(report.enqueued).toBe(1);
  for (const entry of chain) {
    expect(rowsAsText(await sealedRows(third, entry.ref)), entry.ref).toEqual(
      snapshot.get(entry.ref),
    );
  }
  await drainHooks(third);
  const after = await sealedRows(third, 'core.effect');
  expect(after.map((row) => row.status)).toEqual(['succeeded', 'succeeded']);
  expect(endpoint.requests).toHaveLength(2);
  expect(endpoint.requests.map((request) => request.headers['idempotency-key']).sort()).toEqual(
    after.map((row) => String(row.id)).sort(),
  );
  // A second rebuild enqueues nothing and writes nothing.
  const again = await third.runtime.rebuild();
  expect(again.enqueued).toBe(0);
  for (const entity of again.entities)
    expect(entity).toMatchObject({ inserted: 0, updated: 0, purged: 0 });
});

test('a rebuild of the backend scope leaves the effect rows of the tenant alone: the orphan purge stays in the backend (scope_id isolation)', {
  timeout: 300_000,
}, async () => {
  // A database of its own: the scenario above has created the backend of the shared one.
  const booted = await start(
    { serveOnly: true },
    await createTestDatabase('rebuild_backend_scope'),
  );
  await booted.client.invoke('hooks.notify', { payload: 'first' });
  await booted.client.invoke('hooks.notify', { payload: 'second' });
  const before = rowsAsText(await sealedRows(booted, 'core.effect'));
  expect(before).toHaveLength(2);
  const { runtime } = booted;
  const report = await rebuildFromChain({
    adapter: runtime.sealed,
    namespace: runtime.namespace,
    scope: { level: 'backend', backendId: runtime.backendId },
    registry: runtime.app.registry,
    behaviours: entityBehavioursOf(runtime.app.modules),
  });
  // The backend holds no effect of its own: nothing is folded, inserted, updated or purged there.
  expect(report.find((one) => one.entity === 'core.effect')).toMatchObject({
    streams: 0,
    inserted: 0,
    updated: 0,
    purged: 0,
  });
  expect(rowsAsText(await sealedRows(booted, 'core.effect'))).toEqual(before);
});
