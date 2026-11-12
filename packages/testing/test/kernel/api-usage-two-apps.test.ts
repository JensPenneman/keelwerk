import { commandReceiptUuid, defineApiVersions, defineApp } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { library } from '../../src/fixtures/index.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { call, local, ok, spiedMemory, testClock } from './support/core-actions-kit.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

const older = '2026-11-04';
const head = '2026-11-11';
const aging = withTestResolver(
  defineApp({
    id: 'aging',
    modules: [library],
    api: defineApiVersions({
      [older]: { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
      [head]: {},
    }),
  }),
);
const aging2 = withTestResolver(
  defineApp({
    id: 'aging2',
    modules: [library],
    api: defineApiVersions({
      [older]: { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
      [head]: {},
    }),
  }),
);
const bare = withTestResolver(defineApp({ id: 'bare', modules: [] }));
/** The oldest version keeps its support for one customer until 2027, while the middle one is retired already. */
const extended = withTestResolver(
  defineApp({
    id: 'extended',
    modules: [library],
    api: defineApiVersions({
      '2026-01-01': { deprecated: { at: '2026-01-02', sunset: '2027-06-01' } },
      '2026-06-01': { deprecated: { at: '2026-06-02', sunset: '2026-07-01' } },
      [head]: {},
    }),
  }),
);

describe('the operator endpoint of a process that serves two apps (18.5)', () => {
  test('core.apiUsage and core.retireApiVersion answer at deployment scope', async () => {
    const time = testClock();
    time.advance({ hours: 30 * 24 });
    const spy = spiedMemory();
    const two = await boot(deploymentOf('memory', { apps: [aging, bare], factory: spy.factory }), {
      clock: time.clock,
    });
    expect(await ok(call(two.invoker, local, 'core.apiUsage', {}))).toMatchObject({ items: [] });
    const backend = await two.control.createBackend({
      name: 'aging',
      app: 'aging',
      placement: 'main',
    });
    const acme = await two.control.createTenant({
      backendId: backend.id,
      name: 'acme',
      apiVersion: older,
    });
    const retire = () =>
      two.invoker.invoke<unknown, Record<string, unknown>>({
        action: 'core.retireApiVersion',
        input: { app: 'aging', version: older },
        carrier: local,
        requestId: 'retire-request-1',
        commandId: 'retire-1',
        signal: new AbortController().signal,
      });
    const first = await retire();
    if (!first.ok) throw first.error;
    expect(first.value).toEqual({
      app: 'aging',
      version: older,
      floor: head,
      tenants: 1,
      backends: 0,
    });
    // The re-pin names the operator who retired the version, that call's command id and its request.
    const history = await spy.stream('core.tenant', acme.id);
    const repin = history.find((event) => event.action === 'core.tenant.repinApiVersion');
    expect(repin).toMatchObject({
      actor: { kind: 'operator' },
      causationId: 'retire-1',
      correlationId: 'retire-request-1',
    });
    const again = await retire();
    if (!again.ok) throw again.error;
    expect(again.value).toEqual(first.value);
    expect(again.replayed).toBe(true);
    const receipt = await ok(
      call(two.invoker, local, 'core.commandReceipt.get', {
        ids: [commandReceiptUuid(spy.deployment(), 'retire-1')],
      }),
    );
    expect(receipt).toMatchObject({ list: [{ commandId: 'retire-1', status: 'completed' }] });
    expect(JSON.stringify(receipt)).toContain('"tenants":1');
  });

  test.each(['memory', 'pglite'] as const)(
    'a command id that comes again with another input changes nothing and answers the mismatch, the same input replays (%s)',
    { timeout: 120_000 },
    async (kind) => {
      const time = testClock();
      time.advance({ hours: 30 * 24 });
      const two = await boot(deploymentOf(kind, { apps: [aging, aging2] }), {
        clock: time.clock,
      });
      for (const name of ['aging', 'aging2']) {
        const backend = await two.control.createBackend({ name, app: name, placement: 'main' });
        await two.control.createTenant({
          backendId: backend.id,
          name: `${name}-acme`,
          apiVersion: older,
        });
      }
      const retire = (app: string) =>
        two.invoker.invoke<unknown, Record<string, unknown>>({
          action: 'core.retireApiVersion',
          input: { app, version: older },
          carrier: local,
          requestId: crypto.randomUUID(),
          commandId: 'retire-same-id',
          signal: new AbortController().signal,
        });
      const pins = async () => {
        const tenants = await ok(call(two.invoker, local, 'core.tenant.query', {}));
        return (tenants.items as readonly { name: string; apiVersion: string }[])
          .map((tenant) => [tenant.name, tenant.apiVersion])
          .sort();
      };
      const first = await retire('aging');
      if (!first.ok) throw first.error;
      expect(await pins()).toEqual([
        ['aging-acme', head],
        ['aging2-acme', older],
      ]);
      const other = await retire('aging2');
      expect(other).toMatchObject({ ok: false, error: { code: 'core.idempotency_mismatch' } });
      // The refusal came first: the other app's tenant was not re-pinned by the refused call.
      expect(await pins()).toEqual([
        ['aging-acme', head],
        ['aging2-acme', older],
      ]);
      const again = await retire('aging');
      if (!again.ok) throw again.error;
      expect(again.value).toEqual(first.value);
      expect(again.replayed).toBe(true);
    },
  );

  test.each(['memory', 'pglite'] as const)(
    'a version whose support was extended keeps its pins while a retired newer one loses them (%s)',
    { timeout: 120_000 },
    async (kind) => {
      const time = testClock();
      time.advance({ hours: 30 * 24 });
      const one = await boot(deploymentOf(kind, { apps: [extended] }), { clock: time.clock });
      const backend = await one.control.createBackend({
        name: 'extended',
        app: 'extended',
        placement: 'main',
      });
      for (const [name, apiVersion] of [
        ['kept', '2026-01-01'],
        ['moved', '2026-06-01'],
      ] as const) {
        await one.control.createTenant({ backendId: backend.id, name, apiVersion });
      }
      const outcome = await ok(
        call(one.invoker, local, 'core.retireApiVersion', {
          app: 'extended',
          version: '2026-06-01',
        }),
      );
      expect(outcome).toEqual({
        app: 'extended',
        version: '2026-06-01',
        floor: head,
        tenants: 1,
        backends: 0,
      });
      const tenants = await ok(call(one.invoker, local, 'core.tenant.query', {}));
      expect(
        (tenants.items as readonly { name: string; apiVersion: string }[])
          .map((tenant) => [tenant.name, tenant.apiVersion])
          .sort(),
      ).toEqual([
        ['kept', '2026-01-01'],
        ['moved', head],
      ]);
    },
  );
});
