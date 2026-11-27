import { erasure } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { chainApp } from './support/erasure-chain-app.ts';

let current: TestRuntime<typeof chainApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

/**
 * The limits of the fence of a data subject (14.7.4): an event that makes a row resolve to an
 * erased subject without the fence seeing it is accepted, the keys of the row it concerns open,
 * and a further erasure of the subject closes them.
 */
const shapes = [
  {
    name: 'a hidden holder with no personal value, handed to the subject through the last segment of a path (the item behind it)',
    holder: 'holderHidden',
    item: 'itemHidden',
  },
  {
    name: 'a row whose data subject is its own hidden field, set to the subject (the before-image leaves that field out)',
    holder: 'parcelHidden',
    item: undefined,
  },
  {
    name: 'a row whose data subject is its own field kept only in state, set to the subject (the before-image leaves that field out)',
    holder: 'parcelState',
    item: undefined,
  },
] as const;

for (const adapter of ['memory', 'pglite'] as const) {
  for (const shape of shapes) {
    test(`${shape.name} is accepted, and the keys open until the subject is erased again (${adapter})`, {
      timeout: 60_000,
    }, async () => {
      const worker = erasure({ pollMs: 3_600_000 });
      const runtime = await startTestRuntime(chainApp, {
        adapter,
        operators: true,
        workers: true,
        tenants: ['acme'],
        eventWorkers: [worker],
      });
      current = runtime;
      const scope = {
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId: runtime.tenants.acme.id,
      } as const;
      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
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
      const opens = async (kind: string, id: string) =>
        runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
          const descriptor = runtime.app.registry.entities.get(`chain.${kind}`)?.descriptor;
          if (descriptor === undefined) throw new Error(`no entity ${kind}`);
          const row = (
            await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })
          ).rows.find((candidate) => candidate.id === id);
          const key = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
            JSON.stringify(row?.secret),
          )?.[1];
          return key !== undefined && (await unit.keys.liveValueKeys([key])).length > 0;
        });
      const erase = async (subject: string) => {
        await operator.invoke(
          'core.eraseSubject',
          { subjectId: subject as never, reason: 'subjectRequest' } as never,
          { prefer: 'async' },
        );
        await runtime.drainJobs();
        await worker.pass();
        await runtime.drainJobs();
      };
      const [ada, carl] = [
        await make('member', 'ada@example.test'),
        await make('member', 'carl@example.test'),
      ];
      const holder = await make(
        shape.holder,
        carl,
        shape.item === undefined ? 'carl secret' : undefined,
      );
      const [kind, id] =
        shape.item === undefined
          ? ([shape.holder, holder] as const)
          : ([shape.item, await make(shape.item, holder, 'carl item')] as const);
      await erase(ada);

      const handed = await operator.attempt('chain.change', {
        kind: shape.holder,
        id: holder,
        link: ada,
      } as never);

      expect(handed).toMatchObject({ ok: true });
      expect(await opens(kind, id)).toBe(true);
      await erase(ada);
      expect(await opens(kind, id)).toBe(false);
    });
  }
}
