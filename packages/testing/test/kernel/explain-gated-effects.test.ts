import type { Carrier, InvocationSession } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineReaction,
  defineRule,
  field,
  invoke,
  shape,
  system,
} from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { setFlag } from './support/targeting-kit.ts';

const item = defineEntity({ prefix: 'itm', fields: { text: field.string({ maxLength: 80 }) } });
const base = defineModuleBase({
  id: 'shop',
  version: '0.1.0',
  entities: { item },
  flags: {
    stopT: defineFlag({ kind: 'boolean', default: true, level: 'tenant', purpose: 'kill-switch' }),
  },
});
const payT = defineCommand(base, {
  gate: 'stopT',
  input: shape({}),
  output: shape({ ran: field.boolean() }),
  principal: ['user', 'anonymous', 'service'],
  decide: () => ({ events: [], result: { ran: true } }),
});
const relay = defineCommand(base, {
  input: shape({}),
  output: shape({ relayed: field.boolean() }),
  principal: 'user',
  decide: () => ({
    events: [],
    effects: [invoke(payT, {}, { as: system('dry-effects') })],
    result: { relayed: true },
  }),
});
const put = defineCommand(base, {
  input: shape({}),
  output: shape({ put: field.boolean() }),
  principal: 'user',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(item);
    return { events: [ctx.write.shop.item.create({ id, text: 'x' })], result: { put: true } };
  },
});
const onItem = defineReaction(base, {
  on: 'shop.item.created',
  timing: 'inline',
  react: () => ({ events: [], effects: [invoke(payT, {}, { as: system('dry-effects') })] }),
});
const shop = defineModule(base, {
  actions: { payT, relay, put },
  reactions: { onItem },
  policies: {
    payT: { user: defineRule(base, payT, { effect: 'allow', principal: 'user' }) },
    relay: { user: defineRule(base, relay, { effect: 'allow', principal: 'user' }) },
    put: { user: defineRule(base, put, { effect: 'allow', principal: 'user' }) },
  },
});
const app = defineApp({ id: 'gated-effects', modules: [shop] as const });
const operator = {
  scope: { level: 'deployment' },
  app: 'gated-effects',
  principal: { kind: 'operator', id: 'op', subject: 'op', roles: [], scopes: [] },
  apiVersion: '2026-11-04',
  deprecation: null,
  resolvedBy: 'local',
  revalidate: () => Promise.reject(new Error('unused')),
} as unknown as InvocationSession;

async function boot() {
  const runtime = await startTestRuntime(app, { operators: true, tenants: ['acme'] });
  onTestFinished(() => runtime.stop());
  const address = tenantAddress(runtime);
  const call = (action: string) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input: {},
      carrier: testCarrier(address.tenant, testPrincipal('ada')) as Carrier,
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  const dry = (ref: string) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action: 'core.explain',
      input: {
        mode: 'dry-run',
        ref,
        as: 'user:ada',
        backend: address.scope.level === 'tenant' ? address.scope.backendId : '',
        tenant: address.tenant.id,
        input: {},
      },
      carrier: { transport: 'cli', local: { inProcess: true } },
      session: operator,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  return { runtime, call, dry };
}
const code = (o: { ok: boolean; error?: { code?: string } }) =>
  o.ok ? 'ok' : (o.error?.code ?? 'error');

describe('an explain dry run decides a gate from the snapshot a real call builds', () => {
  test('with the switch open the dry run of a command whose invoke effect or inline reaction reaches a gated action answers as the real call does', async () => {
    const { call, dry } = await boot();
    const got = {
      realRelay: code(await call('shop.relay')),
      realPut: code(await call('shop.put')),
      dryRelay: code(await dry('shop.relay')),
      dryPut: code(await dry('shop.put')),
    };
    expect(got).toEqual({ realRelay: 'ok', realPut: 'ok', dryRelay: 'ok', dryPut: 'ok' });
  });

  test('a tenant-level switch closed by the backend row refuses the dry run as the explained user, as it refuses the real call', async () => {
    const { runtime, call, dry } = await boot();
    const set = await setFlag(runtime, {
      key: 'shop.stopT',
      backendId: runtime.backendId,
      targeting: { enabled: true, rules: [], fallthrough: { value: false } },
      reason: 'stop',
    });
    expect(set).toMatchObject({ ok: true });
    await runtime.advanceTo(runtime.clock.now().add({ seconds: 1 }));
    expect({ real: code(await call('shop.payT')), dry: code(await dry('shop.payT')) }).toEqual({
      real: 'core.feature_suspended',
      dry: 'core.feature_suspended',
    });
  });

  test('a rule on the kind of the principal closes the switch for the explained user in the dry run, as in the real call', async () => {
    const { runtime, call, dry } = await boot();
    const set = await setFlag(runtime, {
      key: 'shop.stopT',
      backendId: runtime.backendId,
      targeting: {
        enabled: true,
        rules: [{ id: 'users', when: { principalKind: { eq: 'user' } }, serve: { value: false } }],
        fallthrough: { value: true },
      },
      reason: 'stop users',
    });
    expect(set).toMatchObject({ ok: true });
    await runtime.advanceTo(runtime.clock.now().add({ seconds: 1 }));
    expect({ real: code(await call('shop.payT')), dry: code(await dry('shop.payT')) }).toEqual({
      real: 'core.feature_suspended',
      dry: 'core.feature_suspended',
    });
  });
});
