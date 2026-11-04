import { coreApiVersions, defineApp, deriveSurface } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { ada, app, boot, deploymentOf, golden } from './support/runtime-kit.ts';

describe('introspection', () => {
  test('core.introspect answers the surface of the session, core.composition the report', async () => {
    const runtime = await boot(deploymentOf('memory'));
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    const carrier = testCarrier({ name: 't', id: tenant.id }, ada);
    const call = (action: string) =>
      runtime.invoker.invoke({
        action,
        input: {},
        carrier,
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
    const surface = await call('core.introspect');
    expect(surface).toMatchObject({ ok: true });
    if (surface.ok) {
      expect(surface.value).toEqual(runtime.surface('library'));
      expect(surface.value).toEqual(deriveSurface(app, coreApiVersions.dates[0] ?? '').surface);
    }
    expect(await call('core.composition')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});

describe('the control entities (S-26, final fields)', () => {
  test('backend, tenant, domain, placement, namespace and process are what the golden says', () => {
    const only = defineApp({ id: 'only-core', modules: [] });
    const view = Object.fromEntries(
      ['backend', 'tenant', 'domain', 'placement', 'namespace', 'process'].map((name) => {
        const descriptor = only.registry.entities.get(`core.${name}`)?.descriptor;
        return [
          `core.${name}`,
          {
            history: descriptor?.history,
            tenancy: descriptor?.tenancy,
            table: descriptor?.table,
            fields: descriptor?.fields,
            indexes: descriptor?.indexes,
            relations: descriptor?.relations,
          },
        ];
      }),
    );
    expect(JSON.parse(JSON.stringify(view))).toEqual(golden('control-entities'));
  });
});

describe('the introspection setting of a backend (16.2.5)', () => {
  async function surfaceAs(
    introspection: 'public' | 'operator' | undefined,
    principal: ReturnType<typeof testPrincipal>,
  ) {
    const runtime = await boot(deploymentOf('memory'));
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'library',
      placement: 'main',
      ...(introspection === undefined ? {} : { config: { core: { introspection } } }),
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    return runtime.invoker.invoke({
      action: 'core.introspect',
      input: {},
      carrier: testCarrier({ name: 't', id: tenant.id }, principal),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  }

  test('by default any signed-in principal reads it and an anonymous one does not', async () => {
    expect(await surfaceAs(undefined, ada)).toMatchObject({ ok: true });
    expect(await surfaceAs(undefined, testPrincipal(null))).toMatchObject({ ok: false });
  });

  test('public lets anonymous callers read it, operator-only refuses users', async () => {
    expect(await surfaceAs('public', testPrincipal(null))).toMatchObject({ ok: true });
    expect(await surfaceAs('operator', ada)).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });
});
