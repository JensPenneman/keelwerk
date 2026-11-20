import { erasure } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { erasedShelfApp } from './support/erased-shelf-app.ts';
import { rowsAsText } from './support/rows-as-text.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe.each(['memory', 'pglite'] as const)(
  'rebuilding a tenant in which a subject was erased, on %s (7.9.6, 14.7.2)',
  (kind) => {
    test('an erased tombstone is rebuilt with its erasure instant, and a second rebuild writes nothing', {
      timeout: 120_000,
    }, async () => {
      const worker = erasure({ pollMs: 3_600_000 });
      const runtime = await startTestRuntime(erasedShelfApp, {
        adapter: kind,
        operators: true,
        workers: true,
        eventWorkers: [worker],
      });
      cleanup.push(() => runtime.stop());
      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      const [ada, bea] = [crypto.randomUUID(), crypto.randomUUID()];
      const put = async (ownerId: string, title: string) =>
        String(
          (
            (await operator.invoke('shelf.put', {
              ownerId: ownerId as never,
              title,
              secret: `${title} secret`,
            })) as { noteId: string }
          ).noteId,
        );
      const erased = await put(ada, 'erased note');
      const kept = await put(bea, 'kept note');
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: ada as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await worker.pass();

      const descriptor = runtime.app.registry.entities.get('shelf.note')?.descriptor;
      if (descriptor === undefined) throw new Error('no shelf.note');
      const scope = {
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId: runtime.tenants.acme.id,
      } as const;
      const all = { includeArchived: true, includeErased: true } as const;
      const tableRows = () =>
        runtime.sealed.unit(runtime.namespace, scope, async (unit) =>
          rowsAsText((await unit.rows.find(descriptor, all)).rows),
        );
      const before = await tableRows();
      expect(before).toHaveLength(2);
      expect(before.join('')).toContain('kwErasedAt');
      await runtime.sealed.unit(runtime.namespace, scope, (unit) =>
        unit.rows.purge(descriptor, [erased, kept]),
      );
      expect(await tableRows()).toEqual([]);

      const first = await runtime.rebuild('acme');
      expect(first.entities.find((one) => one.entity === 'shelf.note')).toMatchObject({
        streams: 2,
        inserted: 2,
        updated: 0,
        purged: 0,
      });
      expect(await tableRows()).toEqual(before);
      // The table now holds the tombstone, so the stream that folds to it matches its row.
      const again = await runtime.rebuild('acme');
      for (const entity of again.entities)
        expect(entity).toMatchObject({ inserted: 0, updated: 0, purged: 0 });
      expect(await tableRows()).toEqual(before);
    });

    test('a tombstone the table still holds is not inserted again: the first rebuild already writes nothing', {
      timeout: 120_000,
    }, async () => {
      const worker = erasure({ pollMs: 3_600_000 });
      const runtime = await startTestRuntime(erasedShelfApp, {
        adapter: kind,
        operators: true,
        workers: true,
        eventWorkers: [worker],
      });
      cleanup.push(() => runtime.stop());
      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      const ada = crypto.randomUUID();
      await operator.invoke('shelf.put', {
        ownerId: ada as never,
        title: 'erased note',
        secret: 'a secret',
      });
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: ada as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await worker.pass();
      const report = await runtime.rebuild('acme');
      expect(report.entities.find((one) => one.entity === 'shelf.note')).toMatchObject({
        streams: 1,
        inserted: 0,
        updated: 0,
        purged: 0,
      });
    });
  },
);
