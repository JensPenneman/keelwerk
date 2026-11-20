import type { Carrier, DataAdapter, Unit } from '@keelwerk/core';
import { entityBehavioursOf, KeelwerkError } from '@keelwerk/core';
import { rebuildFromChain } from '@keelwerk/core/replay';
import { afterEach, describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { spiedMemory } from './support/core-actions-kit.ts';
import { type HookEndpoint, startHookEndpoint } from './support/hook-endpoint.ts';
import { type BootedHooks, bootHooks } from './support/hooks-kit.ts';
import { drainHooks, rowsOf } from './support/hooks-reads.ts';
import { rowsAsText } from './support/rows-as-text.ts';
import { boot as bootRuntime, deploymentOf } from './support/runtime-kit.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function boot(kind: 'memory' | 'pglite', serveOnly = false, operators = false) {
  const endpoint: HookEndpoint = await startHookEndpoint();
  const hooks = await bootHooks({ adapter: kind, endpoint: endpoint.url, serveOnly, operators });
  cleanup.push(
    () => hooks.runtime.stop(),
    () => endpoint.close(),
  );
  return { ...hooks, endpoint };
}

/** Both chain entities the hooks scenario writes, in the order a rebuild folds them. */
const folded = ['hooks.delivery', 'core.effect'] as const;

async function notified(booted: BootedHooks, drain = true): Promise<void> {
  await booted.client.invoke('hooks.notify', { payload: '{"hello":"world"}' });
  if (drain) await drainHooks(booted);
}

/** Hard-deletes every row of the entity below the sealing layer, as a lost table would. */
async function emptied(booted: BootedHooks, entity: string): Promise<void> {
  const entry = booted.runtime.app.registry.entities.get(entity);
  if (entry === undefined) throw new Error(`no entity ${entity}`);
  const ids = (await rowsOf(booted, entity)).map((row) => String(row.id));
  await booted.raw((unit) => unit.rows.purge(entry.descriptor, ids));
}

const headOf = (booted: BootedHooks) => booted.raw((unit) => unit.events.head());

describe.each(['memory', 'pglite'] as const)(
  'rebuilding a tenant from its chain on %s (7.9.6)',
  (kind) => {
    test('rows purged from the chain entity tables come back as they were, core.effect last, and the head does not move', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind);
      await notified(booted);
      const before = {
        delivery: rowsAsText(await rowsOf(booted, 'hooks.delivery')),
        effect: rowsAsText(await rowsOf(booted, 'core.effect')),
      };
      expect(before.delivery).toHaveLength(1);
      const head = await headOf(booted);
      await emptied(booted, 'hooks.delivery');
      await emptied(booted, 'core.effect');
      expect(await rowsOf(booted, 'core.effect')).toEqual([]);
      const report = await booted.runtime.rebuild();
      expect(report.entities.at(-1)?.entity).toBe('core.effect');
      for (const entity of folded) {
        expect(report.entities.find((one) => one.entity === entity)).toMatchObject({
          streams: 1,
          inserted: 1,
          updated: 0,
          purged: 0,
        });
      }
      expect(rowsAsText(await rowsOf(booted, 'hooks.delivery'))).toEqual(before.delivery);
      expect(rowsAsText(await rowsOf(booted, 'core.effect'))).toEqual(before.effect);
      expect(await headOf(booted)).toBe(head);
    });

    test('a second rebuild inserts, updates and purges nothing', { timeout: 90_000 }, async () => {
      const booted = await boot(kind);
      await notified(booted);
      await emptied(booted, 'hooks.delivery');
      await emptied(booted, 'core.effect');
      await booted.runtime.rebuild();
      const again = await booted.runtime.rebuild();
      expect(again.entities.length).toBeGreaterThan(0);
      for (const entity of again.entities) {
        expect(entity).toMatchObject({ inserted: 0, updated: 0, purged: 0 });
      }
      expect(again.entities.find((one) => one.entity === 'core.effect')?.streams).toBe(1);
    });

    test('the inline effects and the request of decisions that prepared are rebuilt as they were, and a second rebuild writes nothing', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind, false, true);
      const { runtime } = booted;
      const { acme } = runtime.tenants;
      const invoke = async (action: string, input: unknown, carrier: Carrier) => {
        const outcome = await runtime.invoker.invoke({
          action,
          input,
          carrier,
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId: crypto.randomUUID(),
        });
        if (!outcome.ok) throw outcome.error;
      };
      // An operator command whose prepare performs the inline post, and a user command whose
      // prepare reads the user agent and performs an inline effect.
      await invoke('hooks.testEndpoint', {}, testCarrier(acme, testOperator()));
      const asUser = testCarrier(acme, testPrincipal(crypto.randomUUID()));
      await invoke(
        'probes.look',
        { owner: crypto.randomUUID() },
        { ...asUser, headers: { ...asUser.headers, 'user-agent': 'agent-of-ada/1.0' } },
      );
      const entities = ['core.effect', 'probes.target'] as const;
      const before = new Map<string, readonly string[]>();
      for (const entity of entities) before.set(entity, rowsAsText(await rowsOf(booted, entity)));
      expect(before.get('core.effect')).toHaveLength(2);
      const [target] = await rowsOf(booted, 'probes.target');
      const events = await booted.raw((unit) =>
        unit.events.readStream({ type: 'probes.target', id: String(target?.id) }),
      );
      expect(events[0]?.decision?.prepare).toBeDefined();
      expect(events[0]?.decision?.request).toBeDefined();
      const head = await headOf(booted);
      for (const entity of entities) await emptied(booted, entity);
      await runtime.rebuild();
      for (const entity of entities) {
        expect(rowsAsText(await rowsOf(booted, entity)), entity).toEqual(before.get(entity));
      }
      expect(await headOf(booted)).toBe(head);
      const again = await runtime.rebuild();
      for (const entity of again.entities) {
        expect(entity).toMatchObject({ inserted: 0, updated: 0, purged: 0 });
      }
      expect(await headOf(booted)).toBe(head);
    });

    test('a row no stream accounts for is purged', { timeout: 90_000 }, async () => {
      const booted = await boot(kind);
      await notified(booted);
      const entry = booted.runtime.app.registry.entities.get('hooks.delivery');
      if (entry === undefined) throw new Error('no hooks.delivery');
      const [row] = await rowsOf(booted, 'hooks.delivery');
      const stray = { ...row, id: crypto.randomUUID() };
      await booted.raw((unit) => unit.rows.insert(entry.descriptor, [stray]));
      expect(await rowsOf(booted, 'hooks.delivery')).toHaveLength(2);
      const report = await booted.runtime.rebuild();
      expect(report.entities.find((one) => one.entity === 'hooks.delivery')).toMatchObject({
        streams: 1,
        inserted: 0,
        updated: 0,
        purged: 1,
      });
      expect(await rowsOf(booted, 'hooks.delivery')).toHaveLength(1);
    });

    test('history: state rows and receipts are left as they are', { timeout: 90_000 }, async () => {
      const booted = await boot(kind);
      await notified(booted);
      const { registry } = booted.runtime.app;
      const states = [...registry.entities.values()]
        .filter(
          (entry) =>
            entry.descriptor.history === 'state' &&
            (entry.descriptor.tenancy === 'tenant' || entry.descriptor.tenancy === 'invocation'),
        )
        .map((entry) => entry.ref);
      expect(states.length).toBeGreaterThan(0);
      const snapshots = new Map<string, readonly string[]>();
      for (const ref of states) snapshots.set(ref, rowsAsText(await rowsOf(booted, ref)));
      const report = await booted.runtime.rebuild();
      for (const ref of states) {
        expect(report.entities.map((one) => one.entity)).not.toContain(ref);
        expect(rowsAsText(await rowsOf(booted, ref))).toEqual(snapshots.get(ref));
      }
    });

    test('a rebuild cut at core.effect and run again yields the same rows', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind);
      await notified(booted);
      const before = {
        delivery: rowsAsText(await rowsOf(booted, 'hooks.delivery')),
        effect: rowsAsText(await rowsOf(booted, 'core.effect')),
      };
      await emptied(booted, 'hooks.delivery');
      await emptied(booted, 'core.effect');
      let armed = true;
      const flaky: DataAdapter = {
        ...booted.runtime.sealed,
        unit: (namespace, scope, fn, options) =>
          booted.runtime.sealed.unit(
            namespace,
            scope,
            (unit): Promise<never> | ReturnType<typeof fn> =>
              fn({
                ...unit,
                rows: {
                  ...unit.rows,
                  insert: async (entity, rows) => {
                    if (armed && entity.ref === 'core.effect') {
                      armed = false;
                      throw new KeelwerkError({
                        kind: 'internal',
                        code: 'core.internal',
                        message: 'cut at core.effect',
                      });
                    }
                    await unit.rows.insert(entity, rows);
                  },
                },
              } as Unit),
            options,
          ),
      };
      const input = {
        adapter: flaky,
        namespace: booted.runtime.namespace,
        scope: booted.scope,
        registry: booted.runtime.app.registry,
        behaviours: entityBehavioursOf(booted.runtime.app.modules),
      };
      await expect(rebuildFromChain(input)).rejects.toMatchObject({
        message: 'cut at core.effect',
      });
      expect(await rowsOf(booted, 'core.effect')).toEqual([]);
      expect(rowsAsText(await rowsOf(booted, 'hooks.delivery'))).toEqual(before.delivery);
      const again = await rebuildFromChain(input);
      expect(again.find((one) => one.entity === 'hooks.delivery')).toMatchObject({ inserted: 0 });
      expect(again.find((one) => one.entity === 'core.effect')).toMatchObject({ inserted: 1 });
      expect(rowsAsText(await rowsOf(booted, 'hooks.delivery'))).toEqual(before.delivery);
      expect(rowsAsText(await rowsOf(booted, 'core.effect'))).toEqual(before.effect);
    });

    test('an effect left requested without a job is enqueued once: a second rebuild before the drain enqueues none', {
      timeout: 90_000,
    }, async () => {
      const booted = await boot(kind, true);
      await notified(booted, false);
      const [effect] = await rowsOf(booted, 'core.effect');
      expect(effect?.status).toBe('requested');
      const effectId = String(effect?.id);
      await booted.raw((unit) => unit.jobs.cancel('posts', effectId));
      expect(await booted.raw((unit) => unit.jobs.keyed('posts', effectId))).toBe(false);
      const first = await booted.runtime.rebuild();
      expect(first.enqueued).toBe(1);
      expect(await booted.raw((unit) => unit.jobs.keyed('posts', effectId))).toBe(true);
      const second = await booted.runtime.rebuild();
      expect(second.enqueued).toBe(0);
    });
  },
);

describe('rebuilding a scope that cannot be rebuilt', () => {
  test('the deployment id is unsupported and an unknown id not_found', {
    timeout: 90_000,
  }, async () => {
    const spied = spiedMemory();
    const runtime = await bootRuntime(deploymentOf('memory', { factory: spied.factory }));
    await expect(runtime.control.rebuild(spied.deployment())).rejects.toMatchObject({
      kind: 'unsupported',
    });
    await expect(runtime.control.rebuild(crypto.randomUUID())).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  test('an unknown tenant name rejects instead of throwing', { timeout: 90_000 }, async () => {
    const booted = await boot('memory');
    await expect(booted.runtime.rebuild('nobody' as never)).rejects.toThrow(/no tenant nobody/);
  });
});
