import type { Logger } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineFlag,
  defineHook,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  invoke,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { testClock } from './support/core-actions-kit.ts';
import { bootWorking, deploymentOf } from './support/runtime-kit.ts';
import { setFlag } from './support/targeting-kit.ts';

const refused = (hook: string) => `the lifecycle hook shop.${hook} failed core.feature_suspended`;

/** A module whose hooks invoke gated actions: `shop.pay` by a tenant-level kill switch, `shop.payBackend` by a backend-level one; the rows of the flag store set them. */
async function boot() {
  const runs = { pay: 0, payBackend: 0, seed: 0 };
  const base = defineModuleBase({
    id: 'shop',
    version: '0.1.0',
    flags: {
      stop: defineFlag({ kind: 'boolean', default: true, level: 'tenant', purpose: 'kill-switch' }),
      stopBackend: defineFlag({
        kind: 'boolean',
        default: true,
        level: 'backend',
        purpose: 'kill-switch',
      }),
    },
  });
  const pay = defineCommand(base, {
    gate: 'stop',
    input: shape({}),
    output: shape({ ran: field.boolean() }),
    principal: ['user', 'service'],
    decide: () => {
      runs.pay++;
      return { events: [], result: { ran: true } };
    },
  });
  const payBackend = defineCommand(base, {
    gate: 'stopBackend',
    scope: 'backend',
    input: shape({}),
    output: shape({ ran: field.boolean() }),
    principal: ['user', 'service'],
    decide: () => {
      runs.payBackend++;
      return { events: [], result: { ran: true } };
    },
  });
  const shop = defineModule(base, {
    actions: { pay, payBackend },
    policies: {
      pay: { svc: defineRule(base, pay, { effect: 'allow', principal: 'service' }) },
      payBackend: { svc: defineRule(base, payBackend, { effect: 'allow', principal: 'service' }) },
    },
    lifecycle: {
      onBackend: defineHook(base, 'onBackendCreated', () => ({
        events: [],
        effects: [invoke(payBackend, {})],
      })),
      seed: defineHook(base, 'onTenantCreated', () => {
        runs.seed++;
        // The first run, the one the creation queued, fails; the rerun decides directly.
        if (runs.seed === 1) throw new Error('the first run breaks');
        return { events: [], effects: [invoke(pay, {})] };
      }),
    },
  });
  const failures: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, fields) => {
      const cause = (fields as { cause?: { code?: string } } | undefined)?.cause;
      failures.push(`${message} ${cause?.code ?? ''}`.trim());
    },
    child: () => logger,
  };
  const app = withTestResolver(defineApp({ id: 'hook-gates', modules: [shop] }));
  // `defineApp` runs each command's decide once on a probe (`checkSettleWhere`): not a run of a hook.
  runs.pay = 0;
  runs.payBackend = 0;
  const time = testClock();
  const working = await bootWorking(deploymentOf('memory', { apps: [app] }), {
    clock: time.clock,
    logger,
  });
  const { runtime } = working;
  const createBackend = () =>
    runtime.control.createBackend({ name: 'b', app: 'hook-gates', placement: 'main' });
  /** Writes a row and steps the clock past the cache's bound, so the next snapshot reads it. */
  const setRow = async (input: Record<string, unknown>) => {
    expect(await setFlag(runtime, { ...input, reason: 'test' })).toMatchObject({ ok: true });
    time.advance({ seconds: 2 });
  };
  return { ...working, runs, failures, createBackend, setRow };
}

const row = (value: boolean, rules: readonly unknown[] = []) => ({
  enabled: true,
  rules,
  fallthrough: { value },
});

describe('a lifecycle hook that reaches a gated action', () => {
  test('the creation of a backend runs it while the kill switch is open and refuses it while it is closed', async () => {
    for (const open of [true, false]) {
      const world = await boot();
      await world.setRow({ key: 'shop.stopBackend', targeting: row(open) });
      await world.createBackend();
      expect(world.runs.payBackend).toBe(open ? 1 : 0);
      expect(world.failures.includes(refused('onBackend'))).toBe(!open);
    }
  });

  test('the rerun of the hooks of a tenant runs it while the kill switch is open and refuses it while it is closed', async () => {
    for (const open of [true, false]) {
      const world = await boot();
      const backend = await world.createBackend();
      const tenant = await world.runtime.control.createTenant({ backendId: backend.id, name: 't' });
      await world.drain();
      // The row serves the tenant alone: a snapshot built at another scope reads the fallthrough.
      await world.setRow({
        key: 'shop.stop',
        backendId: backend.id,
        targeting: row(true, [{ id: 'only', tenants: [tenant.id], serve: { value: open } }]),
      });
      world.runs.pay = 0;
      const again = await world.runtime.control.rerunTenantHooks(tenant.id);
      expect(again).toEqual(open ? [] : ['shop.seed']);
      expect(world.runs.pay).toBe(open ? 1 : 0);
    }
  });
});
