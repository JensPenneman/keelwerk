import { entityBehavioursOf } from '@keelwerk/core';
import { rebuildFromChain } from '@keelwerk/core/replay';
import { afterEach, describe, expect, test } from 'vitest';
import { type HookEndpoint, startHookEndpoint } from './support/hook-endpoint.ts';
import { type BootedHooks, bootHooks } from './support/hooks-kit.ts';
import { rowsAsText } from './support/rows-as-text.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** The rows of `core.effect` in the tenant, through the sealing layer, erased and archived ones included. */
async function tenantEffects(booted: BootedHooks) {
  const entry = booted.runtime.app.registry.entities.get('core.effect');
  if (entry === undefined) throw new Error('no core.effect');
  const { runtime, scope } = booted;
  return runtime.sealed.unit(runtime.namespace, scope, async (unit) =>
    rowsAsText(
      (await unit.rows.find(entry.descriptor, { includeArchived: true, includeErased: true })).rows,
    ),
  );
}

describe.each(['memory', 'pglite'] as const)(
  'a rebuild of the backend scope beside a tenant that holds invocation rows, on %s (14.7.6)',
  (kind) => {
    test('the orphan purge stays in the backend: the effect rows of the tenant are neither purged nor rewritten', {
      timeout: 120_000,
    }, async () => {
      const endpoint: HookEndpoint = await startHookEndpoint();
      const booted = await bootHooks({ adapter: kind, endpoint: endpoint.url, serveOnly: true });
      cleanup.push(
        () => booted.runtime.stop(),
        () => endpoint.close(),
      );
      await booted.client.invoke('hooks.notify', { payload: 'first' });
      await booted.client.invoke('hooks.notify', { payload: 'second' });
      const before = await tenantEffects(booted);
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
      expect(await tenantEffects(booted)).toEqual(before);
    });
  },
);
