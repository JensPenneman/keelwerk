import { defineApp, exportCaslRules, normalizeRule, runtimeOperator } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { booted, call, local, ok } from './support/core-actions-kit.ts';
import { ada, app, boot, deploymentOf } from './support/runtime-kit.ts';

describe('core.me and core.capabilities (sections 8.7 and 18.7)', () => {
  test('the operator endpoint answers both: for the one app it serves, or for the core itself', async () => {
    const runtime = await booted();
    expect(await ok(call(runtime.invoker, local, 'core.me'))).toMatchObject({
      principal: { kind: 'operator' },
    });
    expect((await ok(call(runtime.invoker, local, 'core.capabilities'))).apiVersions).toEqual([
      { version: '2026-11-04', status: 'current' },
    ]);
    const bare = withTestResolver(defineApp({ id: 'bare', modules: [] }));
    const two = await boot(deploymentOf('memory', { apps: [app, bare] }));
    expect((await ok(call(two.invoker, local, 'core.capabilities'))).apiVersions).toEqual([
      { version: '2026-11-04', status: 'current' },
    ]);
    expect(await ok(call(two.invoker, local, 'core.me'))).toMatchObject({
      principal: { kind: 'operator' },
    });
  });

  test('an app that declares no API versions lists its head', async () => {
    const bare = withTestResolver(defineApp({ id: 'bare', modules: [] }));
    const runtime = await boot(deploymentOf('memory', { apps: [bare] }));
    const document = await ok(call(runtime.invoker, local, 'core.capabilities'));
    expect(document.apiVersions).toEqual([{ version: '2026-11-04', status: 'current' }]);
  });

  test('me answers the principal and its rules in CASL raw-rule shape', async () => {
    const runtime = await booted();
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const me = await ok(
      call(runtime.invoker, testCarrier({ name: 'acme', id: tenant.id }, ada), 'core.me'),
    );
    expect(me.principal).toMatchObject({ kind: 'user', id: 'ada' });
    const rules = me.rules as { action: string[]; subject: string; serverOnly?: true }[];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(Array.isArray(rule.action)).toBe(true);
      expect(typeof rule.subject).toBe('string');
    }
    // Operator rules of the core do not reach a user.
    expect(rules.some((rule) => rule.subject === 'core.tenant')).toBe(false);
    const anonymous = await ok(
      call(
        runtime.invoker,
        testCarrier({ name: 'acme', id: tenant.id }, testPrincipal(null)),
        'core.me',
      ),
    );
    expect(anonymous.principal).toMatchObject({ kind: 'anonymous' });
  });

  test('core.me takes no input at all over a tenant session', async () => {
    const runtime = await booted();
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const outcome = await runtime.invoker.invoke({
      action: 'core.me',
      input: undefined,
      carrier: testCarrier({ name: 'acme', id: tenant.id }, ada),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(outcome).toMatchObject({ ok: true, value: { principal: { kind: 'user', id: 'ada' } } });
  });

  test('an operator sees the core rules as plain entries', () => {
    const core = defineApp({ id: 'only-core', modules: [] });
    const operator = { ...runtimeOperator, id: 'ops' };
    const rules = exportCaslRules({
      rules: [...core.registry.rules.values()].map(normalizeRule),
      principal: operator,
      scope: { level: 'deployment' },
    });
    const tenantRule = rules.find((rule) => rule.subject === 'core.tenant');
    expect(tenantRule).toMatchObject({ action: ['manage'] });
    expect(tenantRule).not.toHaveProperty('conditions');
    expect(rules.some((rule) => rule.subject === 'core.operatorToken')).toBe(true);
    expect(rules.every((rule) => rule.serverOnly === undefined)).toBe(true);
  });

  test('capabilities is public and lists the protocols and the API versions with their status', async () => {
    const runtime = await booted();
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const document = await ok(
      call(
        runtime.invoker,
        testCarrier({ name: 'acme', id: tenant.id }, testPrincipal(null)),
        'core.capabilities',
      ),
    );
    expect(document.protocols).toEqual({ invocation: [1] });
    expect(document.apiVersions).toEqual([{ version: '2026-11-04', status: 'current' }]);
  });
});
