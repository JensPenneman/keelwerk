import type { Carrier } from '@keelwerk/core';
import { defineApp, defineHook, defineModule, defineModuleBase } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import {
  booted,
  call,
  local,
  ok,
  operatorHost,
  spiedMemory,
  testClock,
} from './support/core-actions-kit.ts';
import { ada, boot, deploymentOf } from './support/runtime-kit.ts';

describe('tenant entry and pins (sections 8.8 and 18.3)', () => {
  async function withTenant() {
    const spy = spiedMemory();
    const runtime = await boot(
      deploymentOf('memory', { factory: spy.factory, operator: { hosts: [operatorHost] } }),
      { clock: testClock().clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    return { runtime, tenant, backend, spy };
  }

  test('enter is logged as an event of the tenant, by the operator who entered', async () => {
    const { runtime, tenant, spy } = await withTenant();
    await ok(
      call(runtime.invoker, local, 'core.tenant.enter', { id: tenant.id, reason: 'ticket 41' }),
    );
    const history = await ok(
      call(runtime.invoker, local, 'core.tenant.history', { id: tenant.id }),
    );
    const entries = history.entries as { event: string; actor: Record<string, unknown> }[];
    expect(entries.map((entry) => entry.event)).toEqual(['created', 'entered']);
    expect(entries[1]?.actor).toMatchObject({ kind: 'operator', id: 'local.in-process' });
    const raw = await spy.stream('core.tenant', tenant.id);
    expect(
      raw.filter(
        (event) => event.type !== 'core.tenant.created' && event.type !== 'core.tenant.create',
      ),
    ).toEqual([
      expect.objectContaining({ type: 'core.tenant.entered', data: { reason: 'ticket 41' } }),
    ]);
    expect(
      await call(runtime.invoker, local, 'core.tenant.enter', { id: tenant.id, reason: '' }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('setApiVersion pins a date and refuses text that is no date', async () => {
    const { runtime, tenant } = await withTenant();
    const pinned = await ok(
      call(runtime.invoker, local, 'core.tenant.setApiVersion', {
        id: tenant.id,
        apiVersion: '2026-11-04',
      }),
    );
    expect(pinned.apiVersion).toBe('2026-11-04');
    for (const apiVersion of ['yesterday', '2026-02-30']) {
      expect(
        await call(runtime.invoker, local, 'core.tenant.setApiVersion', {
          id: tenant.id,
          apiVersion,
        }),
        apiVersion,
      ).toMatchObject({ ok: false, error: { kind: 'validation' } });
    }
  });

  test('setApiVersion refuses a date the app does not declare and names the known ones', async () => {
    const { runtime, tenant } = await withTenant();
    const refused = await call(runtime.invoker, local, 'core.tenant.setApiVersion', {
      id: tenant.id,
      apiVersion: '2020-01-01',
    });
    expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(String(refused.ok ? '' : refused.error.message)).toContain('2026-11-04');
  });

  test('operators may use the generated writes of the control entities (S-75)', async () => {
    const { runtime, tenant } = await withTenant();
    const updated = await ok(
      call(runtime.invoker, local, 'core.tenant.update', {
        id: tenant.id,
        ifVersion: 1,
        name: 'Acme NV',
      }),
    );
    expect(updated.name).toBe('Acme NV');
    await ok(call(runtime.invoker, local, 'core.tenant.archive', { id: tenant.id }));
  });

  test('a host name resolves in the form core.domain stores: lower case, no port, no trailing dot', async () => {
    const runtime = await booted();
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({
      backendId: backend.id,
      name: 'acme',
      domains: ['Shop.Example.'],
    });
    const carrier: Carrier = {
      ...testCarrier({ name: 'acme', id: tenant.id }, ada),
      headers: { 'x-tenant': 'ignored-by-hostname' },
      host: 'SHOP.example:8443',
    };
    const session = await runtime.invoker.open(carrier);
    expect(session).toMatchObject({ ok: true, value: { scope: { tenantId: tenant.id } } });
    const bad = await runtime.invoker.open({ ...carrier, host: 'not a host!' });
    expect(bad).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });
});

describe('lifecycle hook outcomes on the tenant stream (S-84)', () => {
  const base = defineModuleBase({ id: 'flaky', version: '0.1.0' });
  const flaky = defineModule(base, {
    lifecycle: {
      onCreated: defineHook(base, 'onTenantCreated', () => {
        throw new Error('the hook breaks');
      }),
    },
  });
  const flakyApp = withTestResolver(defineApp({ id: 'flaky-app', modules: [flaky] }));

  test('a failed hook is recorded as core.tenant.hookFailed and the tenant stays created', async () => {
    const spy = spiedMemory();
    const runtime = await boot(deploymentOf('memory', { apps: [flakyApp], factory: spy.factory }), {
      clock: testClock().clock,
    });
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'flaky-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    const history = await ok(
      call(runtime.invoker, local, 'core.tenant.history', { id: tenant.id }),
    );
    const entries = history.entries as { event: string; changes: unknown }[];
    expect(entries.map((entry) => entry.event)).toEqual(['created', 'hookFailed']);
    const raw = await spy.stream('core.tenant', tenant.id);
    expect(raw.at(-1)).toMatchObject({
      type: 'core.tenant.hookFailed',
      data: { hook: 'flaky.onCreated' },
    });
  });

  test('a rerun that now succeeds appends core.tenant.hookCompleted { hook }', async () => {
    let broken = true;
    const mending = defineModule(base, {
      lifecycle: {
        onCreated: defineHook(base, 'onTenantCreated', () => {
          if (broken) throw new Error('the hook breaks');
          return { events: [] };
        }),
      },
    });
    const app = withTestResolver(defineApp({ id: 'mending-app', modules: [mending] }));
    const spy = spiedMemory();
    const runtime = await boot(deploymentOf('memory', { apps: [app], factory: spy.factory }), {
      clock: testClock().clock,
    });
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'mending-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    broken = false;
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual([]);
    const raw = await spy.stream('core.tenant', tenant.id);
    expect(raw.at(-1)).toMatchObject({
      type: 'core.tenant.hookCompleted',
      data: { hook: 'flaky.onCreated' },
    });
    expect(raw.map((event) => event.type).filter((type) => type.includes('hook'))).toEqual([
      'core.tenant.hookFailed',
      'core.tenant.hookCompleted',
    ]);
  });
});

describe.each(['memory', 'pglite'] as const)(
  'a deployment entity with its own backend_id field on %s',
  (kind) => {
    test('setApiVersion updates the tenant row and keeps its backend', async () => {
      const runtime = await boot(deploymentOf(kind, { operator: { hosts: [operatorHost] } }), {
        clock: testClock().clock,
      });
      const backend = await runtime.control.createBackend({
        name: 'library',
        app: 'library',
        placement: 'main',
      });
      const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
      const pinned = await ok(
        call(runtime.invoker, local, 'core.tenant.setApiVersion', {
          id: tenant.id,
          apiVersion: '2026-11-04',
        }),
      );
      expect(pinned).toMatchObject({ apiVersion: '2026-11-04', backendId: backend.id });
    }, 60_000);
  },
);
