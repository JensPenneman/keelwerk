import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory, Unit } from '@keelwerk/core';
import { frameworkTrack } from '@keelwerk/data';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from './support/create-test-database.ts';
import { openClients } from './support/open-clients.ts';
import { runScenario } from './support/run-scenario.ts';
import { slice2 } from './support/slice-2.ts';
import { tamperedPlanner } from './support/tampered-planner.ts';

/** Records, for every unit and nested unit the kernel receives, whether the row store carries `lock`. */
function observing(inner: DataAdapterFactory, seen: boolean[]): DataAdapterFactory {
  const observe = (unit: Unit): Unit => {
    seen.push(unit.rows.lock !== undefined);
    return {
      ...unit,
      nested: (fn, options) => unit.nested((child) => fn(observe(child)), options),
    };
  };
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (ns, scope, fn, options) =>
          adapter.unit(ns, scope, (unit) => fn(observe(unit)), options),
      };
    },
  };
}

describe.each([
  ['accelerations on', 'slice2_on', {}],
  ['rowLocks and notify off', 'slice2_off', { accelerations: { rowLocks: false, notify: false } }],
] as const)('slice 2 on PostgreSQL 18 with %s', (name, database, accelerations) => {
  const off = name !== 'accelerations on';
  const lockSeen: boolean[] = [];
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  let kit: ReturnType<typeof slice2>;
  beforeAll(async () => {
    urls = await createTestDatabase(database);
    kit = slice2({
      factory: observing(postgresAdapter({ ownerUrl: urls.adminUrl, ...accelerations }), lockSeen),
      url: urls.appUrl,
      volatile: false,
    });
  }, 120_000);
  afterAll(() => kit?.adapters.closeAll());

  test('the release step applies the committed files, then production starts and runs the scenario', {
    timeout: 120_000,
  }, async () => {
    const release = await kit.boot('test');
    await release.stop(1000);

    const runtime = await kit.boot('production');
    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    try {
      await runScenario(kit, runtime);
      expect(lockSeen.length).toBeGreaterThan(0);
      expect(new Set(lockSeen)).toEqual(new Set([!off]));
      // Only this suite's database: other test files run against the same cluster at the same time.
      const listeners = await owner.query(
        "select 1 from pg_stat_activity where application_name like '%-listen' and datname = $1",
        [database],
      );
      if (off) expect(listeners.rowCount).toBe(0);
      const history = (
        await kit.adapters.adapter('main').schema.history(kit.adapters.namespace())
      ).filter((entry) => entry.track !== frameworkTrack);
      expect(history.map((entry) => `${entry.track}/${entry.id}`)).toEqual([
        'library/0001-initial',
        'library/0002-related-to',
      ]);
    } finally {
      await owner.end();
      await runtime.stop(1000);
    }
  });

  test('production refuses to start when an applied file has changed', {
    timeout: 120_000,
  }, async () => {
    await (await kit.boot('test')).stop(1000);
    await expect(kit.boot('production', tamperedPlanner())).rejects.toMatchObject({
      kind: 'conflict',
      message: expect.stringMatching(/library 0001-initial changed after it was applied/),
    });
  });

  test('a writer in one tenant never waits for the counter row another tenant holds', {
    timeout: 120_000,
  }, async () => {
    const runtime = await kit.boot('production');
    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    try {
      const { ada, inGlobex, tenants } = await openClients(kit, runtime);
      await ada.invoke('library.addBook', { title: 'A1', isbn: 'wait-a1' });
      await inGlobex.invoke('library.addBook', { title: 'B1', isbn: 'wait-b1' });
      await owner.query('begin');
      await owner.query(
        `select 1 from "${kit.adapters.namespace().root}".kw_positions where scope_id = $1 for update`,
        [tenants.globex.id],
      );
      let blockedDone = false;
      const blocked = inGlobex
        .invoke('library.addBook', { title: 'B2', isbn: 'wait-b2' })
        .then(() => {
          blockedDone = true;
        });
      await ada.invoke('library.addBook', { title: 'A2', isbn: 'wait-a2' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(blockedDone).toBe(false);
      await owner.query('commit');
      await blocked;
      expect(blockedDone).toBe(true);
    } finally {
      await owner.end();
      await runtime.stop(1000);
    }
  });
});
