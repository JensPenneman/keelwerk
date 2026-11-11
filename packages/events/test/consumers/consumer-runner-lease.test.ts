import type { StoredEvent } from '@keelwerk/core';
import { createLocalClient, startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { vaultApp } from '@keelwerk/testing/fixtures';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createConsumerRunner } from '../../src/consumers/create-consumer-runner.ts';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { deploymentId, soon, startConsumerKit } from './support/consumer-kit.ts';

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumer runner leases on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    test('killing the lease holder moves the lease to another runner within its ttl', async () => {
      const consumer = kit.counting('test.takeover');
      const leaseMs = 30_000;
      const first = kit.runnerOf(consumer.spec, 'one', { leaseMs });
      const second = kit.runnerOf(consumer.spec, 'two', { leaseMs });
      expect((await first.pass()).holding).toBe(true);
      expect((await second.pass()).holding).toBe(false);
      await kit.addBooks('acme', 2);
      // The first runner is gone: it never renews, and the second one finds the lease held until it ends.
      kit.clock.advance(leaseMs / 3);
      expect((await second.pass()).holding).toBe(false);
      kit.clock.advance(leaseMs);
      const pass = await second.pass();
      expect(pass.holding).toBe(true);
      expect(pass.batches).toBeGreaterThan(0);
      const stored = await kit.eventsOf('acme');
      expect(await kit.checkpoint('test.takeover', 'acme')).toBe(stored.at(-1)?.position);
    });

    test('a runner that lost its lease runs no further batch', async () => {
      const consumer = kit.counting('test.lost');
      const leaseMs = 30_000;
      const first = kit.runnerOf(consumer.spec, 'one', { leaseMs });
      const second = kit.runnerOf(consumer.spec, 'two', { leaseMs });
      await kit.addBooks('acme', 1);
      await first.pass();
      await second.pass();
      kit.clock.advance(leaseMs + 1);
      expect((await second.pass()).holding).toBe(true);
      const reached = await kit.checkpoint('test.lost', 'acme');
      expect(reached).not.toBeNull();
      await kit.addBooks('acme', 2);
      first.wake([kit.scopeIdOf('acme')]);
      const calls = consumer.calls.length;
      expect(await first.pass()).toEqual({ holding: false, batches: 0 });
      expect(consumer.calls).toHaveLength(calls);
      expect(await kit.checkpoint('test.lost', 'acme')).toBe(reached);
    });

    test('a namespace that misses framework step 0002 gives no lease and no batch', async () => {
      const consumer = kit.counting('test.not-ready');
      await kit.addBooks('acme', 1);
      const runner = kit.runnerOf(consumer.spec, 'one', { ready: async () => false });
      expect(await runner.pass()).toEqual({ holding: false, batches: 0 });
      expect(consumer.calls).toEqual([]);
      const taken = await kit.runtime.sealed.unit(
        kit.runtime.namespace,
        { level: 'namespace', reason: 'test' },
        (unit) => unit.consumers.acquireLease('test.not-ready', 'other', 1000),
        { readOnly: false },
      );
      expect(taken).toBe(true);
    });

    test('stop hands the lease over at once', async () => {
      const consumer = kit.counting('test.stop');
      const first = kit.runnerOf(consumer.spec, 'one');
      await first.pass();
      const taken = (): Promise<boolean> =>
        kit.runtime.sealed.unit(
          kit.runtime.namespace,
          { level: 'namespace', reason: 'test' },
          (unit) => unit.consumers.acquireLease('test.stop', 'other', 1000),
          { readOnly: false },
        );
      await first.stop(soon());
      expect(await taken()).toBe(true);
    });
  },
);

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumers and sealed values on %s',
  (kind) => {
    test('events reach the consumer as stored: a sealed secret stays sealed', async () => {
      const secret = 'plain-api-key-0123456789';
      const runtime = await startTestRuntime(vaultApp, {
        tenants: ['acme'],
        adapter: kind,
        config: { vault: { endpoint: 'https://vault.example', signingKey: 'sign-me-secret' } },
      });
      try {
        const ada = createLocalClient(runtime, { principal: testPrincipal('ada') });
        await ada.invoke('vault.store', { label: 'main', apiKey: secret });
        const seen: StoredEvent[] = [];
        const { namespace } = runtime;
        const backendId = runtime.backendId;
        const tenantId = runtime.tenants.acme.id;
        const lookup = {
          hostname: async () => undefined,
          backend: async () => undefined,
          tenant: async (id: string) =>
            id === tenantId
              ? {
                  id,
                  backendId,
                  placementId: namespace.placementId,
                  namespace,
                  status: 'active' as const,
                }
              : undefined,
        };
        const runner = createConsumerRunner({
          spec: {
            id: 'test.sealed',
            selector: {},
            start: 'beginning',
            consume: async (events) => {
              seen.push(...events);
            },
          },
          source: {
            namespace,
            handle: { adapter: runtime.sealed },
            registry: vaultApp.registry,
          },
          directory: lookup,
          deploymentId,
          owner: 'one',
          leaseMs: 30_000,
          batchSize: 100,
          clock: runtime.clock,
          log: runtime.log,
          ready: async () => true,
        });
        expect((await runner.pass()).holding).toBe(true);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.some((event) => event.stream.type === 'vault.credential')).toBe(true);
        expect(
          JSON.stringify(seen, (_, value: unknown) =>
            typeof value === 'bigint' ? String(value) : value,
          ),
        ).not.toContain(secret);
      } finally {
        await runtime.stop();
      }
    }, 60_000);
  },
);
