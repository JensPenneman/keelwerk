import { afterEach, describe, expect, test } from 'vitest';
import { bootRetention, type RetentionKit } from './support/retention-kit.ts';

let kit: RetentionKit | undefined;
afterEach(async () => {
  await kit?.runtime.stop();
  kit = undefined;
});

const kinds = ['memory', 'pglite'] as const;
const run = { timeout: 60_000 } as const;

describe('a buffer that fails', () => {
  test.each(kinds)(
    'a transient purge that fails on every pass leaves the receipts of the scope purged, on %s',
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
      const past = kit.runtime.clock.now().subtract({ hours: 2 });
      for (const pass of [1, 2]) {
        const expired = crypto.randomUUID();
        await kit.plantReceipt('acme', expired, 'completed', past);
        const runs = await kit.pass();
        expect(await kit.receiptOf('acme', expired)).toBeUndefined();
        const acme = runs.find((entry) => entry.tenantId === failing);
        expect(acme?.outcome).toBe('failed');
        expect(acme?.error).toEqual({ kind: 'internal', code: 'core.internal' });
        expect(acme?.removed.receipts).toBe(1);
        expect(acme?.removed.transientRecords).toBe(0);
        // The failed buffer stays listed and gets no horizon; the buffers around it have theirs.
        expect(acme?.rule.rules.map((rule) => rule.kind)).toEqual([
          'receipts',
          'transientRecords',
          'jobHistory',
          'streamTickets',
          'streamRecords',
        ]);
        expect(Object.keys(acme?.horizons ?? {})).toEqual([
          'receipts',
          'jobHistory',
          'streamTickets',
        ]);
        const stored = await kit.context().control.retention.list({
          backendId: kit.runtime.backendId,
          tenantId: failing,
          limit: 5,
        });
        expect(stored).toHaveLength(pass);
        expect(stored[0]).toMatchObject({ outcome: 'failed', removed: { receipts: 1 } });
        expect(JSON.stringify(stored)).not.toContain('must not be stored');
      }
      const failures = kit.lines.filter(
        (line) => line.level === 'error' && line.message.includes('buffer failed'),
      );
      expect(failures).toHaveLength(2);
      expect(failures[0]?.fields).toMatchObject({ buffer: 'transientRecords' });
    },
  );

  test.each(kinds)(
    'one pass logs one line for each buffer that failed, with the stream only for a declared stream, on %s',
    run,
    async (kind) => {
      let failing: string | undefined;
      kit = await bootRetention(kind, {
        insideUnit: async (scope, buffer) => {
          if (scope.level !== 'tenant' || scope.tenantId !== failing) return;
          if (buffer === 'receipts' || buffer === 'jobHistory' || buffer === 'streamRecords')
            throw new Error(`the ${buffer} buffer fails`);
        },
      });
      await kit.pass();
      failing = kit.runtime.tenants.acme.id;
      const runs = await kit.pass();
      const lines = kit.lines.filter(
        (line) => line.level === 'error' && line.message.includes('buffer failed'),
      );
      expect(lines.map((line) => line.fields)).toEqual([
        { scopeId: failing, buffer: 'receipts', cause: expect.any(Error) },
        { scopeId: failing, buffer: 'jobHistory', cause: expect.any(Error) },
        {
          scopeId: failing,
          buffer: 'streamRecords',
          stream: 'retprobe.notes',
          cause: expect.any(Error),
        },
      ]);
      expect(lines[0]?.fields).not.toHaveProperty('stream');
      // The first failure gives the error of the run: one run row, not one for each line.
      expect(runs.filter((entry) => entry.tenantId === failing)).toHaveLength(1);
    },
  );
});
