import { defineApp, defineHook, defineModule, defineModuleBase } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { call, operatorHost, testClock } from './support/core-actions-kit.ts';
import { ada, boot, deploymentOf, type Kind } from './support/runtime-kit.ts';

const kinds: readonly Kind[] = ['memory', 'pglite'];

describe.each(kinds)('an operator token away from an operator host on %s', (kind) => {
  test('answers unauthenticated at once, before the resolvers of the app', {
    timeout: 60_000,
  }, async () => {
    const runtime = await boot(deploymentOf(kind, { operator: { hosts: [operatorHost] } }), {
      clock: testClock().clock,
    });
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const carrier = testCarrier({ name: 'acme', id: tenant.id }, ada);
    const plain = await call(runtime.invoker, carrier, 'core.me');
    expect(plain).toMatchObject({ ok: true });
    const withToken = {
      ...carrier,
      headers: { ...carrier.headers, authorization: 'Bearer kwo_aaaaaaaaaaaaaaaaaaaaaaaaaa_b' },
    };
    expect(await call(runtime.invoker, withToken, 'core.me')).toMatchObject({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });
});

describe('rerunTenantHooks', () => {
  test('reruns only the hooks whose latest outcome is a failure', async () => {
    const hooksBase = defineModuleBase({ id: 'hooks', version: '0.1.0' });
    const calls = { steady: 0, flaky: 0 };
    let broken = true;
    const hooks = defineModule(hooksBase, {
      lifecycle: {
        steady: defineHook(hooksBase, 'onTenantCreated', () => {
          calls.steady++;
          return { events: [] };
        }),
        flaky: defineHook(hooksBase, 'onTenantCreated', () => {
          calls.flaky++;
          if (broken) throw new Error('the hook breaks');
          return { events: [] };
        }),
      },
    });
    const app = withTestResolver(defineApp({ id: 'hooks-app', modules: [hooks] }));
    const runtime = await boot(deploymentOf('memory', { apps: [app] }), {
      clock: testClock().clock,
    });
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'hooks-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    expect(calls).toEqual({ steady: 1, flaky: 1 });
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual(['hooks.flaky']);
    expect(calls).toEqual({ steady: 1, flaky: 2 });
    broken = false;
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual([]);
    expect(calls).toEqual({ steady: 1, flaky: 3 });
    // Completed: nothing is left to rerun.
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual([]);
    expect(calls).toEqual({ steady: 1, flaky: 3 });
  });
});
