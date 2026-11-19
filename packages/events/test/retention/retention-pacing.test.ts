import type { Receipt } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { retention } from '../../src/retention/retention.ts';
import { fakeRetentionContext } from './support/fake-retention-context.ts';
import {
  retain,
  retainedTenantScope,
  retainFully,
  retentionScopeOf,
} from './support/retain-scope-fake.ts';
import { bootRetention, type RetentionKit } from './support/retention-kit.ts';

let kit: RetentionKit | undefined;
afterEach(async () => {
  await kit?.runtime.stop();
  kit = undefined;
});

const kinds = ['memory', 'pglite'] as const;
const run = { timeout: 60_000 } as const;

describe('the budget of one buffer in one pass', () => {
  test('a buffer that used its batches ends undrained, without a horizon, and the others go on', async () => {
    const fake = retentionScopeOf(retainedTenantScope, 'ns-a', {
      transient: [10, 10, 10, 10, 3],
      jobs: [4],
    });
    const result = await retainFully(fake.scope, 10, undefined, { maxBatches: 2 });
    expect(fake.calls.filter((call) => call === 'transient')).toHaveLength(2);
    expect(result.run?.removed.transientRecords).toBe(20);
    expect(result.run?.horizons).not.toHaveProperty('transientRecords');
    // The next buffer has its own budget and drains.
    expect(result.run?.horizons).toHaveProperty('jobHistory');
    expect(result.failures).toEqual([]);
  });

  test('a buffer that drains with its last batch of the budget keeps its horizon', async () => {
    const fake = retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [10, 4] });
    const run = await retain(fake.scope, 10);
    expect(run?.horizons).toHaveProperty('transientRecords');
    const exact = await retainFully(
      retentionScopeOf(retainedTenantScope, 'ns-a', { transient: [10, 4] }).scope,
      10,
      undefined,
      { maxBatches: 2 },
    );
    expect(exact.run?.horizons).toHaveProperty('transientRecords');
  });

  test('a declared stream has the budget too', async () => {
    const fake = retentionScopeOf(retainedTenantScope, 'ns-a', { expire: [10, 10, 10, 10, 3] });
    const result = await retainFully(fake.scope, 10, undefined, { maxBatches: 3 });
    expect(fake.calls.filter((call) => call === 'expire')).toHaveLength(3);
    expect(result.run?.removed.streamRecords).toEqual({ 'shelf.log': 30 });
  });

  test('a buffer stops before the batch that the pass may no longer run', async () => {
    const fake = retentionScopeOf(retainedTenantScope, 'ns-a', {
      transient: [10, 10, 10, 10, 3],
      jobs: [2],
    });
    let asked = 0;
    const result = await retainFully(fake.scope, 10, undefined, {
      // The window closes after three batches of the scope: the receipts' and two of the
      // transient records.
      mayContinue: async () => {
        asked += 1;
        return asked <= 3;
      },
    });
    expect(fake.calls.filter((call) => call === 'transient')).toHaveLength(2);
    expect(fake.calls).not.toContain('jobs');
    expect(result.run?.removed.transientRecords).toBe(20);
    expect(result.run?.horizons).not.toHaveProperty('transientRecords');
    expect(result.run?.horizons).not.toHaveProperty('jobHistory');
  });

  test.each(kinds)(
    'a backlog is spread over passes and drains on the last, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind, { batchSize: 2, maxBatchesPerPass: 1 });
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      const commands = Array.from({ length: 5 }, () => crypto.randomUUID());
      for (const commandId of commands)
        await kit.plantReceipt('acme', commandId, 'completed', past);
      const left = async () =>
        (await Promise.all(commands.map((commandId) => kit?.receiptOf('acme', commandId)))).filter(
          (receipt): receipt is Receipt => receipt !== undefined,
        ).length;
      const acme = (runs: Awaited<ReturnType<RetentionKit['pass']>>) =>
        runs.find((entry) => entry.tenantId === kit?.runtime.tenants.acme.id);
      // One batch of two a pass; a buffer that was cut off gives no horizon.
      const first = acme(await kit.pass());
      expect(await left()).toBe(3);
      expect(first?.removed.receipts).toBe(2);
      expect(first?.horizons).not.toHaveProperty('receipts');
      const second = acme(await kit.pass());
      expect(await left()).toBe(1);
      expect(second?.horizons).not.toHaveProperty('receipts');
      // The batch that finds one receipt is short: it drains.
      const third = acme(await kit.pass());
      expect(await left()).toBe(0);
      expect(third?.removed.receipts).toBe(1);
      expect(third?.horizons).toHaveProperty('receipts');
    },
  );

  test('refuses a budget that is no whole number of batches', () => {
    for (const bad of [0, -1, 1.5, 1_000_001]) {
      expect(() => retention({ maxBatchesPerPass: bad })).toThrow('maxBatchesPerPass');
    }
    expect(() => retention({ maxBatchesPerPass: 1_000_000 })).not.toThrow();
  });
});

describe('the budget and the window of a worker pass', () => {
  test('a pass runs at most maxBatchesPerPass batches of a buffer, however many are left', async () => {
    const fake = fakeRetentionContext(new AbortController().signal, undefined, false, {
      transient: () => ({ removed: 10, more: true }),
    });
    const worker = retention({ batchSize: 10, maxBatchesPerPass: 3 });
    await worker.start(fake.context);
    await worker.pass();
    // The pass at the start and the one asked for: three batches each.
    expect(fake.transientCalls).toHaveBeenCalledTimes(6);
    await worker.stop(Temporal.Now.instant());
  });

  test('a scheduled pass ends when its window closes and starts no further batch', async () => {
    const fake = fakeRetentionContext(new AbortController().signal, '2026-11-18T03:59:30Z', false, {
      transient: () => ({ removed: 10, more: true }),
      // The first batch ends at one second past the end of the window.
      afterTransient: () => fake.setNow('2026-11-18T04:00:01Z'),
    });
    const worker = retention({ batchSize: 10, window: { start: '02:00', end: '04:00' } });
    await worker.start(fake.context);
    await vi.waitFor(() => expect(fake.transientCalls).toHaveBeenCalledTimes(1));
    await worker.stop(fake.context.clock.now().add({ hours: 1 }));
    // The pass at the start was a scheduled one; nothing ran after the window closed.
    expect(fake.transientCalls).toHaveBeenCalledTimes(1);
    expect(fake.historyCalls).not.toHaveBeenCalled();
  });

  test('a pass asked for ignores the window, as before', async () => {
    const fake = fakeRetentionContext(new AbortController().signal, '2026-11-18T12:00:00Z', false, {
      transient: () => ({ removed: 10, more: true }),
    });
    const worker = retention({
      batchSize: 10,
      maxBatchesPerPass: 2,
      window: { start: '02:00', end: '04:00' },
    });
    await worker.start(fake.context);
    await worker.pass();
    expect(fake.transientCalls).toHaveBeenCalledTimes(2);
    await worker.stop(Temporal.Now.instant());
  });
});

describe('the lease of the worker', () => {
  test('a process that does not get the lease runs no pass', async () => {
    const fake = fakeRetentionContext(new AbortController().signal, undefined, false, {
      lease: { acquire: () => false },
    });
    const worker = retention({});
    await worker.start(fake.context);
    expect(await worker.pass()).toEqual([]);
    expect(fake.acquired).toHaveBeenCalled();
    expect(fake.opened).not.toHaveBeenCalled();
    expect(fake.reached()).toBe(false);
    expect(fake.infos.some((line) => line.includes('lease'))).toBe(true);
    await worker.stop(Temporal.Now.instant());
  });

  test('a pass gives the lease back when it ends', async () => {
    const fake = fakeRetentionContext(new AbortController().signal);
    const worker = retention({});
    await worker.start(fake.context);
    await worker.pass();
    expect(fake.renewed).toHaveBeenLastCalledWith('events.retention', expect.any(String), 0);
    await worker.stop(Temporal.Now.instant());
  });

  test('a long pass renews the lease between batches, and ends when it is lost', async () => {
    let held = true;
    const fake = fakeRetentionContext(new AbortController().signal, undefined, false, {
      transient: () => ({ removed: 10, more: true }),
      lease: { renew: () => held },
      // Every batch takes two minutes of the runtime clock: a renewal is due every third of five.
      afterTransient: (calls) => {
        fake.setNow(`2026-11-18T12:${String(2 * calls).padStart(2, '0')}:00Z`);
        if (calls === 3) held = false;
      },
    });
    const worker = retention({ batchSize: 10, maxBatchesPerPass: 100 });
    await worker.start(fake.context);
    await vi.waitFor(() => expect(fake.transientCalls).toHaveBeenCalledTimes(3));
    // The stop waits for the pass in flight, so a fourth batch would have run by now.
    await worker.stop(fake.context.clock.now().add({ hours: 1 }));
    // Renewed before batch 2 and 3 (due after 100 s), lost at the third: no fourth batch.
    const renewals = fake.renewed.mock.calls.filter((call) => call[2] > 0);
    expect(renewals.length).toBeGreaterThanOrEqual(2);
    expect(fake.transientCalls).toHaveBeenCalledTimes(3);
  });

  test.each(kinds)(
    'a pass over a lease another process holds changes nothing, on %s',
    run,
    async (kind) => {
      kit = await bootRetention(kind);
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      await kit.plantReceipt('acme', 'held-elsewhere', 'completed', past);
      const lease = (
        fn: (unit: {
          consumers: {
            acquireLease(c: string, o: string, ttl: number): Promise<boolean>;
            renewLease(c: string, o: string, ttl: number): Promise<boolean>;
          };
        }) => Promise<boolean>,
      ) =>
        kit?.runtime.control.adapter.unit(
          kit.runtime.control.namespace,
          { level: 'namespace', reason: 'retention lease test' },
          fn,
        );
      expect(
        await lease((unit) =>
          unit.consumers.acquireLease('events.retention', 'another-process', 600_000),
        ),
      ).toBe(true);
      expect(await kit.pass()).toEqual([]);
      expect((await kit.receiptOf('acme', 'held-elsewhere'))?.status).toBe('completed');
      // The other process lets go: the next pass takes the lease and purges.
      await lease((unit) => unit.consumers.renewLease('events.retention', 'another-process', 0));
      const runs = await kit.pass();
      expect(runs.length).toBeGreaterThan(0);
      expect(await kit.receiptOf('acme', 'held-elsewhere')).toBeUndefined();
    },
  );
});
