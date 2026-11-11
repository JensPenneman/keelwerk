import { createHmac } from 'node:crypto';
import { compareHlc } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { type HookEndpoint, startHookEndpoint } from './support/hook-endpoint.ts';
import { type BootedHooks, bootHooks, hooksApp } from './support/hooks-kit.ts';
import { drainHooks, rowsOf } from './support/hooks-reads.ts';
import { jobSpy } from './support/job-spy.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function boot(kind: 'memory' | 'pglite', answer?: (index: number) => number | 'hang') {
  const endpoint: HookEndpoint = await startHookEndpoint(answer);
  const lines: LoggedLine[] = [];
  const hooks = await bootHooks({
    adapter: kind,
    endpoint: endpoint.url,
    logger: recordingLogger(lines),
  });
  cleanup.push(
    () => hooks.runtime.stop(),
    () => endpoint.close(),
  );
  return { ...hooks, endpoint, lines };
}

describe.each(['memory', 'pglite'] as const)('the hooks sketch on %s (7.9.5, M2-4)', (kind) => {
  test('hooks.notify requests post, the executor posts with the effect id as idempotency key, the effect settles succeeded and the delivery is delivered', {
    timeout: 90_000,
  }, async () => {
    const booted = await boot(kind);
    const answer = await booted.client.invoke('hooks.notify', { payload: '{"hello":"world"}' });
    expect(answer).toMatchObject({ deliveryId: expect.any(String) });
    await drainHooks(booted);
    const [effect] = await rowsOf(booted, 'core.effect');
    expect(effect).toMatchObject({
      type: 'hooks.post',
      status: 'succeeded',
      attempts: 1,
      output: { status: 200 },
    });
    // The settled event links to the requested one: the effect table keeps no chain columns.
    const events = await booted.raw((unit) =>
      unit.events.readStream({ type: 'core.effect', id: String(effect?.id) }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'core.effect.created',
      'core.effect.changed',
    ]);
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(events[0]?.hash).not.toBeNull();
    expect(compareHlc(events[1]?.hlc as never, events[0]?.hlc as never)).toBe(1);
    expect(booted.endpoint.requests).toHaveLength(1);
    expect(booted.endpoint.requests[0]?.headers['idempotency-key']).toBe(String(effect?.id));
    expect(booted.endpoint.requests[0]?.body).toBe('{"hello":"world"}');
    const [delivery] = await rowsOf(booted, 'hooks.delivery');
    expect(delivery).toMatchObject({ status: 'delivered', responseStatus: 200 });
    // The continuation is its own decision, caused by the effect's settled record (7.9.6): its
    // events carry the id of that record, as a reaction's job is caused by its event.
    const deliveryEvents = await booted.raw((unit) =>
      unit.events.readStream({ type: 'hooks.delivery', id: String(delivery?.id) }),
    );
    const settledEvent = deliveryEvents.find((event) => event.type === 'hooks.delivery.settled');
    expect(settledEvent?.causationId).toBe(events[1]?.eventId);
    expect(settledEvent?.causationId).not.toBe(String(effect?.id));
    // The module granted itself nothing: the continuation ran under the core's default rule.
    expect(settledEvent?.actor).toMatchObject({ kind: 'service', id: 'hooks.system' });
    // The gate's decision for that principal on the continuation names the default rule and no rule of the module's own.
    const explained = await booted.runtime.invoker.invoke({
      action: 'core.explain',
      input: {
        backend: booted.runtime.backendId,
        tenant: booted.runtime.tenants.acme.id,
        mode: 'decision',
        ref: 'hooks.delivery.recordOutcome',
        as: 'service:hooks.system',
      },
      carrier: {
        transport: 'cli',
        headers: { 'x-tenant': booted.runtime.tenants.acme.id },
        local: { inProcess: true },
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(explained).toMatchObject({
      ok: true,
      value: { allowed: true, rules: [{ id: 'core.ownModule.hooks', effect: 'allow' }] },
    });
  });

  test('the signature header is the HMAC of the body under the configured signing key, and the reveal is logged with its reason', {
    timeout: 90_000,
  }, async () => {
    const booted = await boot(kind);
    await booted.client.invoke('hooks.notify', { payload: 'a body to sign' });
    await drainHooks(booted);
    const request = booted.endpoint.requests[0];
    expect(request?.headers['x-signature-256']).toBe(
      createHmac('sha256', 'hook-signing-key').update('a body to sign').digest('hex'),
    );
    const reveals = booted.lines.filter((line) => line.message === 'executor reveal');
    expect(reveals).toHaveLength(1);
    expect(reveals[0]?.fields).toMatchObject({ reason: 'sign an outbound webhook' });
    expect(JSON.stringify(booted.lines)).not.toContain('hook-signing-key');
  });

  test('the continuation runs once: a second settle of the effect is recognised by its status and enqueues nothing', {
    timeout: 90_000,
  }, async () => {
    const booted = await boot(kind);
    await booted.client.invoke('hooks.notify', { payload: 'once' });
    await drainHooks(booted);
    const [effect] = await rowsOf(booted, 'core.effect');
    expect(effect?.status).toBe('succeeded');
    const before = await deliveryVersion(booted);
    // A duplicate job for the same effect, as a redelivery would leave: it finds the effect settled.
    await booted.raw((unit) =>
      unit.jobs.enqueue({
        kind: 'effect',
        queue: 'hooks',
        run: { executor: 'hooks.post', effect: String(effect?.id) },
        scope: booted.scope,
        principal: { resolver: 'core.module', principalId: 'hooks.system' },
        causation: {},
        build: { id: 'test-build', revision: 1 },
        laneCap: 4,
        createdAt: booted.runtime.clock.now(),
        capability: [],
        key: { value: 'duplicate', onConflict: 'keep' },
      }),
    );
    await drainHooks(booted);
    expect(booted.endpoint.requests).toHaveLength(1);
    expect(await rowsOf(booted, 'hooks.delivery')).toHaveLength(1);
    expect((await rowsOf(booted, 'core.effect'))[0]).toMatchObject({
      attempts: 1,
      status: 'succeeded',
    });
    expect(await deliveryVersion(booted)).toBe(before);
    expect(before).toBe(2);
  });
});

/** The version of the first delivery: the created event and one settled event, however often the continuation ran. */
async function deliveryVersion(booted: BootedHooks): Promise<number> {
  return Number((await rowsOf(booted, 'hooks.delivery'))[0]?.version);
}

describe('the default rule never reaches another tenant (7.7, 7.9.5)', () => {
  test('a continuation job of acme that names a delivery of globex finds nothing and changes nothing', {
    timeout: 90_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    const descriptors = new Map(
      [...hooksApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
    );
    const watched = jobSpy((ref) => descriptors.get(ref));
    const runtime = await startTestRuntime(hooksApp, {
      tenants: ['acme', 'globex'],
      adapter: 'memory',
      config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
      external: { factory: watched.factory, url: 'memory://watched' },
      workers: { queues: ['hooks', 'probes', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
    });
    cleanup.push(
      () => runtime.stop(),
      () => endpoint.close(),
    );
    const scopeOf = (name: 'acme' | 'globex') =>
      ({
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId: runtime.tenants[name].id,
      }) as const;
    const globex = createLocalClient(runtime, {
      principal: testPrincipal('ada'),
      tenant: 'globex',
    });
    await globex.invoke('hooks.notify', { payload: 'for globex' });
    for (let round = 0; round < 6; round += 1) await runtime.drainJobs();
    const deliveries = runtime.app.registry.entities.get('hooks.delivery')?.descriptor;
    if (deliveries === undefined) throw new Error('no hooks.delivery');
    const rowsOfGlobex = () =>
      runtime.adapter.unit(
        runtime.namespace,
        scopeOf('globex'),
        async (unit) => (await unit.rows.find(deliveries, {})).rows,
      );
    const [before] = await rowsOfGlobex();
    expect(before).toMatchObject({ status: 'delivered' });

    watched.spy.completions.length = 0;
    await runtime.adapter.unit(runtime.namespace, scopeOf('acme'), (unit) =>
      unit.jobs.enqueue({
        kind: 'action',
        queue: 'commands',
        run: {
          action: 'hooks.delivery.recordOutcome',
          input: { id: String(before?.id), outcome: { ok: true, value: { status: 500 } } },
          commandId: crypto.randomUUID(),
        },
        scope: scopeOf('acme'),
        principal: { resolver: 'core.module', principalId: 'hooks.system' },
        causation: {},
        build: { id: 'test-build', revision: 1 },
        laneCap: 4,
        createdAt: runtime.clock.now(),
      }),
    );
    for (let round = 0; round < 6; round += 1) await runtime.drainJobs();
    expect(watched.spy.completions.map((entry) => entry.outcome)).toMatchObject([
      { kind: 'failed', error: { kind: 'not_found' } },
    ]);
    expect(await rowsOfGlobex()).toEqual([before]);
  });
});
