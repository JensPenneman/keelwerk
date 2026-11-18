import {
  defineApp,
  defineHook,
  defineModule,
  defineModuleBase,
  errors,
  isOpaqueId,
  refuseReservedCommandId,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { call, spiedMemory, testClock } from './support/core-actions-kit.ts';
import { ada, boot, bootWorking, deploymentOf } from './support/runtime-kit.ts';

/** An app whose one tenant hook runs `behave(attempt)`: the attempts counted from one. */
function appOf(behave: (attempt: number) => void) {
  const base = defineModuleBase({ id: 'jobs', version: '0.1.0' });
  const state = { attempts: 0 };
  const module = defineModule(base, {
    lifecycle: {
      onCreated: defineHook(base, 'onTenantCreated', () => {
        state.attempts += 1;
        behave(state.attempts);
        return { events: [] };
      }),
    },
  });
  return { state, app: withTestResolver(defineApp({ id: 'jobs-app', modules: [module] })) };
}

const hookEvents = (events: readonly { readonly type: string }[]) =>
  events.map((event) => event.type).filter((type) => type.includes('hook'));

describe('tenant hooks run as jobs (decision 147, S-158)', () => {
  test('the tenant is usable before its hooks ran', async () => {
    const { app, state } = appOf(() => undefined);
    const runtime = await boot(deploymentOf('memory', { apps: [app] }), {
      clock: testClock().clock,
    });
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    expect(state.attempts).toBe(0);
    const me = await call(
      runtime.invoker,
      testCarrier({ name: 't', id: tenant.id }, ada),
      'core.me',
    );
    expect(me).toMatchObject({ ok: true });
  });

  test('a hook job retried after a transient failure writes hookFailed once and hookCompleted once', async () => {
    const { app, state } = appOf((attempt) => {
      if (attempt === 1) throw errors.unavailable('not yet');
    });
    const spy = spiedMemory();
    const time = testClock();
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: spy.factory }),
      { clock: time.clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    await drain();
    expect(state.attempts).toBe(1);
    expect(hookEvents(await spy.stream('core.tenant', tenant.id))).toEqual([
      'core.tenant.hookFailed',
    ]);
    time.advance({ hours: 1 });
    await drain();
    expect(state.attempts).toBe(2);
    expect(hookEvents(await spy.stream('core.tenant', tenant.id))).toEqual([
      'core.tenant.hookFailed',
      'core.tenant.hookCompleted',
    ]);
  });

  test('the command id of a hook job is the kernel form of the hook and the tenant, and its receipt completes', async () => {
    const { app, state } = appOf(() => undefined);
    const spy = spiedMemory();
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: spy.factory }),
      { clock: testClock().clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    await drain();
    expect(state.attempts).toBe(1);
    // A caller's command id must be an opaque id and may never be in this form; the kernel's own
    // is exempt from both, so the receipt of the hook is written, completed and found under it.
    const commandId = `kernel:hook:jobs.onCreated:${tenant.id}`;
    expect(() => refuseReservedCommandId(commandId)).toThrow(/reserved/);
    expect(isOpaqueId(commandId)).toBe(false);
    const receipt = await spy.inTenant(
      { level: 'tenant', backendId: backend.id, tenantId: tenant.id },
      (unit) => unit.receipts.get(commandId),
    );
    expect(receipt).toMatchObject({ commandId, status: 'completed' });
  });

  test('a hook that keeps failing ends dead and stays listed', async () => {
    const { app, state } = appOf(() => {
      throw new Error('the hook breaks');
    });
    const spy = spiedMemory();
    const time = testClock();
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: spy.factory }),
      { clock: time.clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    await drain();
    time.advance({ hours: 1 });
    await drain();
    expect(state.attempts).toBe(1);
    expect(hookEvents(await spy.stream('core.tenant', tenant.id))).toEqual([
      'core.tenant.hookFailed',
    ]);
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual(['jobs.onCreated']);
  });

  test('rerunTenantHooks cancels the pending job and runs the hook inline', async () => {
    let healthy = false;
    const { app, state } = appOf((attempt) => {
      if (attempt === 1 || !healthy) throw errors.unavailable('not yet');
    });
    const spy = spiedMemory();
    const time = testClock();
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: spy.factory }),
      { clock: time.clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    await drain();
    // The failed first attempt left a retry pending: the rerun takes its place.
    healthy = true;
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual([]);
    expect(state.attempts).toBe(2);
    time.advance({ hours: 1 });
    await drain();
    expect(state.attempts).toBe(2);
    expect(hookEvents(await spy.stream('core.tenant', tenant.id))).toEqual([
      'core.tenant.hookFailed',
      'core.tenant.hookCompleted',
    ]);
  });

  /** Takes the one hook job of a tenant for a worker that never finishes it: its attempt is lost. */
  const loseFirstAttempt = (
    spy: ReturnType<typeof spiedMemory>,
    backendId: string,
    tenantId: string,
  ) =>
    spy.inTenant({ level: 'tenant', backendId, tenantId }, async (unit) => {
      await unit.jobs.promote('hooks', 10);
      const taken = await unit.jobs.take('hooks', 'a-worker-that-died', {
        limit: 1,
        capabilitySets: [''],
        maxRevision: Number.MAX_SAFE_INTEGER,
        leaseMs: 60_000,
      });
      expect(taken.jobs).toHaveLength(1);
    });

  test('a hook whose first attempt was lost and whose later attempts fail ends dead and is listed', async () => {
    const { app, state } = appOf(() => {
      throw new Error('the hook breaks');
    });
    const spy = spiedMemory();
    const time = testClock();
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: spy.factory }),
      { clock: time.clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    // The worker that took attempt 1 is gone (a redeploy): the take raised the attempt number and
    // nothing was recorded. Once its lease lapsed the next worker runs attempt 2.
    await loseFirstAttempt(spy, backend.id, tenant.id);
    time.advance({ hours: 1 });
    await drain();
    expect(state.attempts).toBe(1);
    expect(hookEvents(await spy.stream('core.tenant', tenant.id))).toEqual([
      'core.tenant.hookFailed',
    ]);
  });

  test('rerunTenantHooks cancels a hook job that is running, so the hook never runs twice', async () => {
    const { app, state } = appOf((attempt) => {
      if (attempt === 1) throw errors.unavailable('not yet');
    });
    const spy = spiedMemory();
    const time = testClock();
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: spy.factory }),
      { clock: time.clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'jobs-app',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    await drain();
    expect(state.attempts).toBe(1);
    // Attempt 2 is running in a worker, and the operator reruns the hook that doctor lists.
    time.advance({ hours: 1 });
    await loseFirstAttempt(spy, backend.id, tenant.id);
    expect(await runtime.control.rerunTenantHooks(tenant.id)).toEqual([]);
    expect(state.attempts).toBe(2);
    // The running attempt was cancelled: when its lease lapses no worker takes it again.
    time.advance({ hours: 1 });
    await drain();
    expect(state.attempts).toBe(2);
  });
});
