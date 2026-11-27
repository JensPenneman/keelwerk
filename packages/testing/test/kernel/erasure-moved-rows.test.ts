import type { LedgerRecord, Scope } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { chainApp } from './support/erasure-chain-app.ts';
import { watchedSink } from './support/watched-sink.ts';

let current: TestRuntime<typeof chainApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

/** How a row of a living subject can come to have been the erased subject's: its own field or a row its path runs through. */
const shapes = [
  { name: 'a holder its item reads the subject through', holder: 'holder2', item: 'item2' },
  {
    name: 'a hidden holder its item reads the subject through',
    holder: 'holderHidden',
    item: 'itemHidden',
  },
  { name: 'a parcel whose subject field is hidden', holder: undefined, item: 'parcelHidden' },
  {
    name: 'a parcel whose subject field is kept only in state',
    holder: undefined,
    item: 'parcelState',
  },
] as const;

for (const adapter of ['memory', 'pglite'] as const) {
  for (const shape of shapes.filter(
    (candidate) => adapter === 'memory' || candidate.holder === 'holder2',
  )) {
    test(`${shape.name} is given to a living subject while the erasure runs: the transfer is accepted and the key opens (${adapter})`, {
      timeout: 60_000,
    }, async () => {
      const hook: { key?: string; run?: () => Promise<void> } = {};
      const sink = watchedSink(async (records: readonly LedgerRecord[]) => {
        if (!records.some((r) => r.type === 'keyTombstone' && r.keyId === hook.key)) return;
        const { run } = hook;
        delete hook.run;
        await run?.();
      });
      const worker = erasure({ pollMs: 3_600_000 });
      const runtime = await startTestRuntime(chainApp, {
        adapter,
        operators: true,
        workers: true,
        tenants: ['acme'],
        eventWorkers: [worker],
        ledgers: [sink],
      });
      current = runtime;
      const scope: Scope = {
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId: runtime.tenants.acme.id,
      };
      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      const rowOf = (kind: string, id: string) =>
        runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
          const descriptor = runtime.app.registry.entities.get(`chain.${kind}`)?.descriptor;
          if (descriptor === undefined) throw new Error(`no entity ${kind}`);
          return (
            await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })
          ).rows.find((row) => row.id === id);
        });
      const opens = async (keyId: string) =>
        (
          await runtime.adapter.unit(runtime.namespace, scope, (unit) =>
            unit.keys.liveValueKeys([keyId]),
          )
        ).length > 0;
      const keyOf = async (id: string) =>
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
          JSON.stringify((await rowOf(shape.item, id))?.secret),
        )?.[1] ?? '';
      const make = async (kind: string, link: string, secret?: string) =>
        String(
          (
            (await operator.invoke('chain.make', {
              kind,
              link,
              ...(secret === undefined ? {} : { secret }),
            } as never)) as { id: string }
          ).id,
        );
      const [ada, bea] = [
        await make('member', 'ada@example.test'),
        await make('member', 'bea@example.test'),
      ];
      const parent = async (owner: string) =>
        shape.holder === undefined ? owner : make(shape.holder, owner);
      const [moved, kept] = [await parent(ada), await parent(bea)];
      const item = await make(shape.item, moved, 'ada item');
      const beaItem = await make(shape.item, kept, 'bea item');
      hook.key = await keyOf(item);
      const beaKey = await keyOf(beaItem);
      let handed: unknown;
      hook.run = async () => {
        // The sink takes the tombstone the erasure recorded for the item's key: what decides its subject goes to bea.
        handed = await operator.attempt('chain.change', {
          kind: shape.holder ?? shape.item,
          id: shape.holder === undefined ? item : moved,
          link: bea,
        } as never);
      };

      await operator.invoke(
        'core.eraseSubject',
        { subjectId: ada as never, reason: 'subjectRequest' } as never,
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await worker.pass();
      await runtime.drainJobs();

      expect(hook.run).toBeUndefined();
      expect(handed).toMatchObject({ ok: true });
      expect(await opens(hook.key ?? '')).toBe(true);
      expect(await opens(beaKey)).toBe(true);
    });
  }
}
