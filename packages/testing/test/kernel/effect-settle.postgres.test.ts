import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { compareHlc } from '@keelwerk/core';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { bootHooks } from './support/hooks-kit.ts';
import { drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';

describe('the settled record of an effect on PostgreSQL (7.9.6)', () => {
  const stops: (() => Promise<void>)[] = [];

  afterAll(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  });

  test('the settled record links to the requested one: its prevHash is the requested hash and its clock is later', {
    timeout: 120_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    stops.push(() => endpoint.close());
    const database = await createTestDatabase('effect_settle_chain');
    const booted = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
    });
    stops.push(() => booted.runtime.stop());
    await booted.client.invoke('hooks.notify', { payload: 'chain' });
    await drainHooks(booted);
    const effect = await effectOf(booted, 'hooks.post');
    expect(effect).toMatchObject({ status: 'succeeded' });
    const events = await booted.raw((unit) =>
      unit.events.readStream({ type: 'core.effect', id: String(effect?.id) }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'core.effect.created',
      'core.effect.changed',
    ]);
    expect(events[0]?.hash).not.toBeNull();
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(compareHlc(events[1]?.hlc as never, events[0]?.hlc as never)).toBe(1);
  });

  test('two jobs for one effect settle it once: the second begin waits for the row lock of the first', {
    timeout: 180_000,
  }, async () => {
    // Every request is answered after a pause, so the executors of both jobs overlap.
    const endpoint = await startHookEndpoint(() => 200, 400);
    stops.push(() => endpoint.close());
    const database = await createTestDatabase('effect_settle_race');
    const external = {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    };
    // P only requests: the effect and its job exist, and no worker takes them yet.
    const p = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external,
      serveOnly: true,
    });
    stops.push(() => p.runtime.stop());
    await p.client.invoke('hooks.notify', { payload: 'twice' });
    const requested = await effectOf(p, 'hooks.post');
    await p.raw((unit) =>
      unit.jobs.enqueue({
        kind: 'effect',
        queue: 'posts',
        run: { executor: 'hooks.post', effect: String(requested?.id) },
        scope: p.scope,
        principal: { resolver: 'core.module', principalId: 'hooks.system' },
        causation: {},
        build: { id: 'test-build', revision: 1 },
        laneCap: 4,
        createdAt: p.runtime.clock.now(),
        capability: [],
        key: { value: 'duplicate', onConflict: 'keep' },
      }),
    );
    // The two jobs begin together; the begin reads the effect under its row lock.
    const lines: LoggedLine[] = [];
    const r = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external,
      logger: recordingLogger(lines),
      join: { backendId: p.runtime.backendId, tenants: { acme: p.runtime.tenants.acme.id } },
    });
    stops.push(() => r.runtime.stop());
    await vi.waitFor(
      async () => {
        expect((await effectOf(p, 'hooks.post'))?.status).not.toBe('requested');
      },
      { timeout: 120_000, interval: 500 },
    );
    await drainHooks(r);
    const effect = await effectOf(p, 'hooks.post');
    const events = await p.raw((unit) =>
      unit.events.readStream({ type: 'core.effect', id: String(effect?.id) }),
    );
    // One record of creation and one of settlement, a linear chain, and one continuation.
    expect(events.map((event) => event.type)).toEqual([
      'core.effect.created',
      'core.effect.changed',
    ]);
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(compareHlc(events[1]?.hlc as never, events[0]?.hlc as never)).toBe(1);
    const deliveries = await rowsOf(p, 'hooks.delivery');
    expect(deliveries).toHaveLength(1);
    // Created once and settled once: the continuation ran once.
    expect(Number(deliveries[0]?.version)).toBe(2);
    // Without the lock a second settle fails at its append and the end unit has to be saved.
    expect(lines.filter((line) => line.message === 'the end of the attempt failed')).toEqual([]);
  });
});
