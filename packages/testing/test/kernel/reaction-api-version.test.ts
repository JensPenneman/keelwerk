import {
  createComputePool,
  defineApiVersions,
  defineApp,
  deriveEffectId,
  entityBehavioursOf,
  kernelCommandId,
  normalizeRule,
} from '@keelwerk/core';
import { redecide } from '@keelwerk/core/replay';
import { afterAll, describe, expect, test } from 'vitest';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { bootReactions, tenantEventsOf } from './support/reactions-kit.ts';
import type { RelayApp } from './support/relay-app.ts';
import { relay } from './support/relay-module.ts';
import { watch } from './support/watch-module.ts';

const older = '2026-03-01';
const head = '2026-06-01';
const app = defineApp({
  id: 'relayapp',
  modules: [relay, watch] as never,
  api: defineApiVersions({ [older]: {}, [head]: {} }),
}) as unknown as RelayApp;

// The tenant acme is pinned to the older version; globex has no pin.
const kit = await bootReactions({ app, tenantApiVersions: { acme: older } });
afterAll(() => kit.stop());

const receiptOf = (tenant: 'acme' | 'globex', commandId: string) =>
  kit.runtime.adapter.unit(kit.runtime.namespace, kit.scopeOf(tenant), (unit) =>
    unit.receipts.get(commandId),
  );

describe('the API version of a reaction job (7.7)', () => {
  test('is the head of the build that runs it, whatever the tenant is pinned to, for the job and for its nested command', async () => {
    expect((await kit.send('acme', { channel: 'pin' })).ok).toBe(true);
    expect((await kit.send('globex', { channel: 'pin' })).ok).toBe(true);
    await kit.settle();
    for (const tenant of ['acme', 'globex'] as const) {
      const created = (await tenantEventsOf(kit, tenant)).find(
        (event) => event.type === 'relay.signal.created',
      );
      if (created === undefined) throw new Error('the signal event is missing');
      // The command that wrote the signal ran at the pin; the jobs the reactions ran as run at the head.
      const wrote = await receiptOf(tenant, created.commandId ?? '');
      expect(wrote?.apiVersion).toBe(tenant === 'acme' ? older : head);
      const jobId = kernelCommandId('reaction', 'relay.nested', created.eventId);
      const job = await receiptOf(tenant, jobId);
      expect(job).toMatchObject({ status: 'completed', apiVersion: head });
      // The command the reaction invoked is a nested one of the job: the head too.
      const nestedId = kernelCommandId('effect', deriveEffectId(kit.scopeOf(tenant), jobId, 0));
      expect(await receiptOf(tenant, nestedId)).toMatchObject({
        status: 'completed',
        apiVersion: head,
      });
    }
  });

  test('a command a reaction job invoked is re-decided from its recorded input, at the version it ran at', async () => {
    expect((await kit.send('acme', { channel: 'redecide' })).ok).toBe(true);
    await kit.settle();
    const created = (await tenantEventsOf(kit, 'acme')).filter(
      (event) => event.type === 'relay.signal.created',
    );
    const last = created.at(-1);
    if (last === undefined) throw new Error('the signal event is missing');
    const jobId = kernelCommandId('reaction', 'relay.nested', last.eventId);
    const nestedId = kernelCommandId('effect', deriveEffectId(kit.scopeOf('acme'), jobId, 0));
    const { runtime } = kit;
    const { registry } = runtime.app;
    const address = tenantAddress(runtime, 'acme');
    const compute = createComputePool({ size: 1 });
    const redecideAt = (apiVersion: string) =>
      redecide({
        registry,
        adapter: runtime.adapter,
        namespace: address.namespace,
        scope: address.scope,
        commandId: nestedId,
        input: { signal: last.stream.id },
        apiVersion,
        behaviours: entityBehavioursOf(runtime.app.modules),
        rules: [...registry.rules.values()]
          .filter((rule) => rule.disabled !== true)
          .map(normalizeRule),
        keys: runtime.keys,
        compute,
        clock: runtime.clock,
        config: runtime.config,
        log: runtime.log,
        trace: runtime.tracer.startSpan('redecide'),
      });
    try {
      // The nested receipt and the digest of its record hold the head, with no job in the form.
      await expect(redecideAt(head)).resolves.toMatchObject({ reproduced: true });
    } finally {
      await compute.close();
    }
  });
});
