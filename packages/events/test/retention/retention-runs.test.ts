import { afterEach, describe, expect, test } from 'vitest';
import { bootRetention, type RetentionKit } from './support/retention-kit.ts';

let kit: RetentionKit | undefined;
afterEach(async () => {
  await kit?.runtime.stop();
  kit = undefined;
});

const kinds = ['memory', 'pglite'] as const;
const run = { timeout: 60_000 } as const;

/** What a test finds in the kit; a test that did not boot one fails here. */
function booted(): RetentionKit {
  if (kit === undefined) throw new Error('the kit is not booted');
  return kit;
}

describe('a scope that fails', () => {
  test.each(kinds)(
    'a scope whose unit fails leaves the others purged, on %s',
    run,
    async (kind) => {
      let failing: string | undefined;
      kit = await bootRetention(kind, {
        insideUnit: async (scope, buffer) => {
          if (buffer === 'receipts' && scope.level === 'tenant' && scope.tenantId === failing) {
            throw new Error('the unit of this tenant fails');
          }
        },
      });
      failing = kit.runtime.tenants.acme.id;
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      const acme = crypto.randomUUID();
      const globex = crypto.randomUUID();
      await kit.plantReceipt('acme', acme, 'completed', past);
      await kit.plantReceipt('globex', globex, 'completed', past);
      const runs = await kit.pass();
      expect((await kit.receiptOf('acme', acme))?.status).toBe('completed');
      expect(await kit.receiptOf('globex', globex)).toBeUndefined();
      // The failing tenant leaves a failed row, the other a complete one.
      expect(
        runs
          .map((entry) => [entry.tenantId, entry.outcome])
          .sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
      ).toEqual(
        [
          [kit.runtime.tenants.acme.id, 'failed'],
          [kit.runtime.tenants.globex.id, 'complete'],
        ].sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
      );
      expect(
        kit.lines.filter((line) => line.level === 'error' && line.message.includes('retention')),
      ).toHaveLength(1);
    },
  );

  test.each(kinds)(
    'a scope whose later buffer fails still records what its earlier batches removed, on %s',
    run,
    async (kind) => {
      let failing: string | undefined;
      kit = await bootRetention(kind, {
        insideUnit: async (scope, buffer) => {
          if (buffer === 'receipts' && scope.level === 'tenant' && scope.tenantId === failing) {
            throw new Error('the unit of this tenant fails');
          }
        },
      });
      failing = kit.runtime.tenants.acme.id;
      await kit.plantEvents('acme', crypto.randomUUID(), [
        { ageHours: 24 * 8, kind: 'transient' },
        { ageHours: 24 * 8, kind: 'transient' },
      ]);
      const runs = await kit.pass();
      const acme = runs.find((entry) => entry.tenantId === failing);
      expect(acme?.removed.transientRecords).toBe(1);
      expect(acme?.removed.receipts).toBe(0);
      expect(acme?.outcome).toBe('failed');
      expect(acme?.error).toEqual({ kind: 'internal', code: 'core.internal' });
      // The receipts step began and failed: its rule is listed and it has no horizon; the buffers
      // after it ran, are counted and have their horizons.
      expect(acme?.rule.rules.map((rule) => rule.kind)).toEqual([
        'receipts',
        'transientRecords',
        'jobHistory',
        'streamTickets',
        'streamRecords',
      ]);
      expect(Object.keys(acme?.removed ?? {})).toEqual([
        'receipts',
        'valueKeys',
        'transientRecords',
        'jobHistory',
        'streamTickets',
        'streamRecords',
      ]);
      expect(Object.keys(acme?.horizons ?? {})).toEqual([
        'transientRecords',
        'jobHistory',
        'streamTickets',
      ]);
      expect(
        kit.lines.filter((line) => line.level === 'error' && line.message.includes('retention')),
      ).toHaveLength(1);
    },
  );

  test('a batch whose unit fails at commit is left out of the recorded counts', async () => {
    let failing: string | undefined;
    let armed = false;
    kit = await bootRetention('memory', {
      insideUnit: async (scope, buffer) => {
        armed = buffer === 'receipts' && scope.level === 'tenant' && scope.tenantId === failing;
      },
    });
    failing = booted().runtime.tenants.acme.id;
    const source = booted()
      .context()
      .namespaces.find((entry) => entry.namespace.id === booted().runtime.namespace.id);
    if (source === undefined) throw new Error('the data namespace is not served');
    const adapter = source.handle.adapter;
    const original = adapter.unit.bind(adapter);
    adapter.unit = async (namespace, scope, work) => {
      armed = false;
      const result = await original(namespace, scope, work);
      if (armed) throw new Error('the commit of this unit fails');
      return result;
    };
    await booted().plantEvents('acme', crypto.randomUUID(), [
      { ageHours: 24 * 8, kind: 'transient' },
      { ageHours: 24 * 8, kind: 'transient' },
    ]);
    const past = booted().runtime.clock.now().subtract({ hours: 2 });
    await booted().plantReceipt('acme', crypto.randomUUID(), 'completed', past);
    const runs = await booted().pass();
    const acme = runs.find((entry) => entry.tenantId === failing);
    expect(acme?.removed.transientRecords).toBe(1);
    expect(acme?.removed.receipts).toBe(0);
    expect(acme?.removed.valueKeys).toBe(0);
  });

  test.each(kinds)('a recorded horizon has millisecond precision, on %s', run, async (kind) => {
    kit = await bootRetention(kind);
    await kit.plantEvents('acme', crypto.randomUUID(), [
      { ageHours: 24 * 8, kind: 'transient' },
      { ageHours: 24 * 8, kind: 'transient' },
    ]);
    const runs = await kit.pass();
    expect(runs.length).toBeGreaterThan(0);
    const form = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    for (const entry of runs) {
      for (const horizon of Object.values(entry.horizons)) expect(horizon).toMatch(form);
    }
  });
});

describe('what a run records', () => {
  const ranTransient = [
    { ageHours: 24 * 8, kind: 'transient' },
    { ageHours: 24 * 8, kind: 'transient' },
  ] as const;

  test.each(kinds)(
    'a scope that fails before it removed anything leaves a failed run with its error, on %s',
    run,
    async (kind) => {
      let failing: string | undefined;
      kit = await bootRetention(kind, {
        insideUnit: async (scope, buffer) => {
          if (
            buffer === 'transientRecords' &&
            scope.level === 'tenant' &&
            scope.tenantId === failing
          )
            throw new Error('a message that must not be stored');
        },
      });
      // The pass the worker began at its start has ended before the test arms the failure.
      await kit.pass();
      failing = kit.runtime.tenants.acme.id;
      await kit.plantEvents('acme', crypto.randomUUID(), ranTransient);
      const runs = await kit.pass();
      const acme = runs.find((entry) => entry.tenantId === failing);
      expect(acme).toMatchObject({
        outcome: 'failed',
        error: { kind: 'internal', code: 'core.internal' },
        namespaceId: kit.runtime.namespace.id,
        removed: { transientRecords: 0 },
      });
      expect(acme?.rule.rules.map((rule) => rule.kind)).toEqual([
        'receipts',
        'transientRecords',
        'jobHistory',
        'streamTickets',
        'streamRecords',
      ]);
      expect(acme?.horizons).not.toHaveProperty('transientRecords');
      const stored = await kit.context().control.retention.list({
        backendId: kit.runtime.backendId,
        tenantId: failing,
        limit: 5,
      });
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored[0]?.error)).not.toContain('message');
      expect(JSON.stringify(stored[0])).not.toContain('must not be stored');
    },
  );

  test.each(kinds)(
    'a buffer that drained has a horizon and one that did not has none, on %s',
    run,
    async (kind) => {
      let failing: string | undefined;
      let transientUnits = 0;
      kit = await bootRetention(kind, {
        batchSize: 2,
        insideUnit: async (scope, buffer) => {
          if (buffer !== 'transientRecords' || scope.level !== 'tenant') return;
          if (scope.tenantId !== failing) return;
          transientUnits += 1;
          // The first batch of the transient buffer is full and commits; the second fails.
          if (transientUnits === 2) throw new Error('the second batch fails');
        },
      });
      const old = 24 * 8;
      const many = Array.from({ length: 6 }, () => ({ ageHours: old, kind: 'transient' }) as const);
      await kit.plantEvents('acme', crypto.randomUUID(), many);
      await kit.plantEvents('globex', crypto.randomUUID(), many);
      failing = kit.runtime.tenants.acme.id;
      const runs = await kit.pass();
      const acme = runs.find((entry) => entry.tenantId === failing);
      const globex = runs.find((entry) => entry.tenantId === kit?.runtime.tenants.globex.id);
      // Acme: one full batch of two committed, then a failure: counted, and no horizon.
      expect(acme?.outcome).toBe('failed');
      expect(acme?.removed.transientRecords).toBe(2);
      expect(acme?.horizons).not.toHaveProperty('transientRecords');
      expect(acme?.horizons).toHaveProperty('receipts');
      // Globex: five records go in batches of two, two and one; the short batch drains the buffer.
      expect(globex?.outcome).toBe('complete');
      expect(globex?.removed.transientRecords).toBe(5);
      expect(Object.keys(globex?.horizons ?? {}).sort()).toEqual([
        'jobHistory',
        'receipts',
        'streamTickets',
        'transientRecords',
      ]);
    },
  );

  test.each(kinds)('the deployment scope lists no ticket buffer, on %s', run, async (kind) => {
    kit = await bootRetention(kind);
    const past = kit.runtime.clock.now().subtract({ hours: 2 });
    await kit.plantReceipt('deployment', crypto.randomUUID(), 'failed', past);
    const runs = await kit.pass();
    const deployment = runs.find((entry) => entry.tenantId === null);
    expect(deployment?.backendId).toBe(kit.context().control.deploymentId);
    expect(deployment?.rule.rules.some((rule) => rule.kind === 'streamTickets')).toBe(false);
    expect(deployment?.removed).not.toHaveProperty('streamTickets');
    expect(deployment?.horizons).not.toHaveProperty('streamTickets');
  });

  test.each(kinds)(
    'an expired receipt of an archived tenant is removed and its run recorded, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      const expired = crypto.randomUUID();
      await kit.plantReceipt('acme', expired, 'failed', past);
      await kit.archiveTenant('acme');
      const runs = await kit.pass();
      expect(await kit.receiptOf('acme', expired)).toBeUndefined();
      const acme = runs.find((entry) => entry.tenantId === kit?.runtime.tenants.acme.id);
      expect(acme?.removed.receipts).toBe(1);
      expect(acme?.outcome).toBe('complete');
    },
  );

  test.each(kinds)(
    'an expired receipt of a tenant of an archived backend is removed, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      const expired = crypto.randomUUID();
      await kit.plantReceipt('acme', expired, 'failed', past);
      await kit.archiveBackend();
      const runs = await kit.pass();
      expect(await kit.receiptOf('acme', expired)).toBeUndefined();
      const acme = runs.find((entry) => entry.tenantId === kit?.runtime.tenants.acme.id);
      expect(acme?.removed.receipts).toBe(1);
    },
  );
});
