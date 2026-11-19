import type { RetentionRun } from '@keelwerk/core';
import { parseSealedValueText } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { bootRetention, type RetentionKit } from './support/retention-kit.ts';

let kit: RetentionKit | undefined;
afterEach(async () => {
  await kit?.runtime.stop();
  kit = undefined;
});

const kinds = ['memory', 'pglite'] as const;
const run = { timeout: 60_000 } as const;
const secretLabel = 'a secret only the receipt keeps';

/** What a test finds in the kit; a test that did not boot one fails here. */
function booted(): RetentionKit {
  if (kit === undefined) throw new Error('the kit is not booted');
  return kit;
}

describe('the retention worker', () => {
  test.each(kinds)('an expired failed receipt is gone after a run, on %s', run, async (kind) => {
    kit = await bootRetention(kind);
    const failed = await kit.call('acme', 'retprobe.refuse');
    expect(failed.ok).toBe(false);
    expect((await kit.receiptOf('acme', failed.commandId))?.status).toBe('failed');
    await kit.advance(25);
    const fresh = await kit.call('acme', 'retprobe.refuse');
    const runs = await kit.pass();
    expect(await kit.receiptOf('acme', failed.commandId)).toBeUndefined();
    expect((await kit.receiptOf('acme', fresh.commandId))?.status).toBe('failed');
    expect(runs.some((entry) => entry.removed.receipts === 1)).toBe(true);
  });

  test.each(kinds)(
    'an expired completed receipt and the value key of its secret output are gone, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const minted = await kit.call('acme', 'retprobe.mint');
      expect(minted.ok).toBe(true);
      const receipt = await kit.receiptOf('acme', minted.commandId);
      expect(receipt?.status).toBe('completed');
      const text = (receipt?.outcome as { value?: { token?: string } } | null)?.value?.token;
      const sealed = parseSealedValueText(text ?? '');
      if (sealed === undefined) throw new Error('the receipt holds no sealed token');
      const binding = {
        entity: 'core.commandReceipt',
        id: minted.commandId,
        field: 'outcome.token',
      };
      const opens = () =>
        booted().inTenant('acme', async (unit) => unit.keys.openValue(sealed, binding));
      expect(new TextDecoder().decode(await opens())).toBe(secretLabel);
      await kit.advance(25);
      const runs = await kit.pass();
      expect(await kit.receiptOf('acme', minted.commandId)).toBeUndefined();
      expect(await opens()).toBeUndefined();
      expect(runs.reduce((sum, entry) => sum + (entry.removed.valueKeys ?? 0), 0)).toBe(1);
    },
  );

  test.each(kinds)(
    'a receipt that is not finished or not expired is kept, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      const future = kit.runtime.clock.now().add({ hours: 2 });
      await kit.plantReceipt('acme', crypto.randomUUID(), 'accepted', past);
      const accepted = crypto.randomUUID();
      await kit.plantReceipt('acme', accepted, 'accepted', past);
      const pending = crypto.randomUUID();
      await kit.plantReceipt('acme', pending, 'pending', past);
      const inside = crypto.randomUUID();
      await kit.plantReceipt('acme', inside, 'completed', future);
      const gone = crypto.randomUUID();
      await kit.plantReceipt('acme', gone, 'completed', past);
      await kit.pass();
      expect((await kit.receiptOf('acme', accepted))?.status).toBe('accepted');
      expect((await kit.receiptOf('acme', pending))?.status).toBe('pending');
      expect((await kit.receiptOf('acme', inside))?.status).toBe('completed');
      expect(await kit.receiptOf('acme', gone)).toBeUndefined();
    },
  );

  test.each(kinds)(
    'the receipt of a sync mutation stays until its client has acknowledged it, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      const unacknowledged = crypto.randomUUID();
      await kit.plantReceipt('acme', unacknowledged, 'completed', past, undefined, {
        clientId: 'phone',
        clientSeq: 2,
      });
      const acknowledged = crypto.randomUUID();
      await kit.plantReceipt('acme', acknowledged, 'completed', past, undefined, {
        clientId: 'phone',
        clientSeq: 1,
      });
      const withoutClient = crypto.randomUUID();
      await kit.plantReceipt('acme', withoutClient, 'completed', past);
      await booted().inTenant('acme', (unit) => unit.receipts.acknowledge('phone', 1));
      const runs = await kit.pass();
      expect((await kit.receiptOf('acme', unacknowledged))?.status).toBe('completed');
      expect(await kit.receiptOf('acme', acknowledged)).toBeUndefined();
      expect(await kit.receiptOf('acme', withoutClient)).toBeUndefined();
      const acme = runs.find((entry) => entry.tenantId === booted().runtime.tenants.acme.id);
      expect(acme?.removed.receipts).toBe(2);
      // Once its client acknowledges it, the receipt goes at the next pass.
      await booted().inTenant('acme', (unit) => unit.receipts.acknowledge('phone', 2));
      await kit.pass();
      expect(await kit.receiptOf('acme', unacknowledged)).toBeUndefined();
    },
  );

  test.each(kinds)(
    'transient records older than P7D go, the newest of each stream stays, chained events stay, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const first = crypto.randomUUID();
      const second = crypto.randomUUID();
      const old = 24 * 8;
      await kit.plantEvents('acme', first, [
        { ageHours: old, kind: 'transient' },
        { ageHours: old, kind: 'transient' },
      ]);
      await kit.plantEvents('acme', second, [
        { ageHours: old, kind: 'chained' },
        { ageHours: old, kind: 'transient' },
        { ageHours: old, kind: 'transient' },
        { ageHours: 1, kind: 'transient' },
      ]);
      const runs = await kit.pass();
      expect(await kit.versionsOf('acme', first)).toEqual([2]);
      expect(await kit.versionsOf('acme', second)).toEqual([1, 4]);
      const acme = runs.find((entry) => entry.tenantId === booted().runtime.tenants.acme.id);
      expect(acme?.removed.transientRecords).toBe(3);
    },
  );

  test.each(kinds)(
    'the change records of a receipt go with it, the newest too, and a live receipt keeps its newest, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const old = 24 * 8;
      const records = [
        { ageHours: old, kind: 'transient' },
        { ageHours: old, kind: 'transient' },
        { ageHours: old, kind: 'transient' },
      ] as const;
      await kit.plantEvents('acme', 'expired', records, 'gone');
      await kit.plantReceipt(
        'acme',
        'expired',
        'completed',
        kit.runtime.clock.now().subtract({ hours: 2 }),
      );
      await kit.plantEvents('acme', 'live', records);
      const runs = await kit.pass();
      // The receipt purge runs first, so the same pass finds its stream without a receipt.
      expect(await kit.receiptOf('acme', 'expired')).toBeUndefined();
      expect(await kit.versionsOf('acme', 'expired')).toEqual([]);
      expect(await kit.versionsOf('acme', 'live')).toEqual([3]);
      const acme = runs.find((entry) => entry.tenantId === booted().runtime.tenants.acme.id);
      expect(acme?.removed.receipts).toBe(1);
      expect(acme?.removed.transientRecords).toBe(5);
    },
  );

  test.each(kinds)('job history older than seven days goes, on %s', run, async (kind) => {
    kit = await bootRetention(kind);
    const answered = await kit.call('acme', 'retprobe.queued', undefined, 'async');
    expect(answered.ok).toBe(true);
    await kit.runtime.drainJobs();
    const jobsRemoved = (runs: readonly RetentionRun[]) =>
      runs.reduce((sum, entry) => sum + (entry.removed.jobHistory ?? 0), 0);
    expect(jobsRemoved(await kit.pass())).toBe(0);
    await kit.advance(24 * 8);
    expect(jobsRemoved(await kit.pass())).toBeGreaterThanOrEqual(1);
  });

  test.each(kinds)(
    'a declared stream expires and no other stream is touched, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      await kit.call('acme', 'retprobe.mint');
      await kit.advance(25);
      const runs = await kit.pass();
      const acme = runs.find((entry) => entry.tenantId === booted().runtime.tenants.acme.id);
      expect(acme?.removed.streamRecords).toEqual({ 'retprobe.notes': 1 });
      const streamRules = acme?.rule.rules.filter((rule) => rule.kind === 'streamRecords');
      expect(streamRules).toEqual([
        { kind: 'streamRecords', stream: 'retprobe.notes', maxAge: 'P1D' },
      ]);
    },
  );

  test.each(kinds)(
    'a run is recorded per scope that lost something, the deployment scope with the deployment id and no tenant, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      await kit.plantReceipt('acme', crypto.randomUUID(), 'failed', past);
      await kit.plantReceipt('deployment', crypto.randomUUID(), 'completed', past);
      const runs = await kit.pass();
      const deploymentId = kit.context().control.deploymentId;
      expect(runs.map((entry) => [entry.backendId, entry.tenantId]).sort()).toEqual(
        [
          [kit.runtime.backendId, kit.runtime.tenants.acme.id],
          [deploymentId, null],
        ].sort(),
      );
      const stored = await kit.context().control.retention.list({
        backendId: deploymentId,
        tenantId: null,
        limit: 10,
      });
      expect(stored.map((entry) => entry.runId)).toEqual(
        runs.filter((entry) => entry.tenantId === null).map((entry) => entry.runId),
      );
      expect(stored[0]?.removed.receipts).toBe(1);
      expect(stored[0]?.outcome).toBe('complete');
      expect(stored[0]?.error).toBeNull();
      expect(stored[0]?.namespaceId).toBe(kit.context().control.namespace.id);
      expect(stored[0]).not.toHaveProperty('rule.adoptedBy');
      // The deployment scope keeps no ticket buffer and serves no stream of a tenant: none is listed.
      expect(stored[0]?.rule.rules.map((rule) => rule.kind)).toEqual([
        'receipts',
        'transientRecords',
        'jobHistory',
      ]);
      expect(Object.keys(stored[0]?.removed ?? {}).sort()).toEqual([
        'jobHistory',
        'receipts',
        'transientRecords',
        'valueKeys',
      ]);
      expect(Object.keys(stored[0]?.horizons ?? {}).sort()).toEqual([
        'jobHistory',
        'receipts',
        'transientRecords',
      ]);
      expect(await kit.pass()).toEqual([]);
    },
  );

  test('every unit of a pass carries one scope and runs the buffers of that scope only', async () => {
    const units: { readonly scope: string; readonly buffers: string[] }[] = [];
    const inside: { readonly scope: string }[] = [];
    let current: string[] | undefined;
    kit = await bootRetention('memory', {
      insideUnit: async (scope) => {
        inside.push({ scope: JSON.stringify(scope) });
        current?.push(JSON.stringify(scope));
      },
    });
    const source = booted()
      .context()
      .namespaces.find((entry) => entry.namespace.id === booted().runtime.namespace.id);
    if (source === undefined) throw new Error('the data namespace is not served');
    const adapter = source.handle.adapter;
    const original = adapter.unit.bind(adapter);
    adapter.unit = (namespace, scope, work) =>
      original(namespace, scope, async (unit) => {
        const buffers: string[] = [];
        units.push({ scope: JSON.stringify(scope), buffers });
        const outer = current;
        current = buffers;
        try {
          return await work(unit);
        } finally {
          current = outer;
        }
      });
    inside.length = 0;
    await booted().pass();
    const worked = units.filter((entry) => entry.buffers.length > 0);
    expect(inside.length).toBeGreaterThan(0);
    // Each worker unit ran one buffer, under the scope the unit was opened with.
    for (const entry of worked) expect(entry.buffers).toEqual([entry.scope]);
    expect(worked.length).toBeGreaterThan(0);
    const tenants = new Set(worked.map((entry) => entry.scope));
    expect(tenants.size).toBeGreaterThanOrEqual(3);
  });
});
