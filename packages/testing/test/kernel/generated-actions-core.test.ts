import { describe, expect, test } from 'vitest';
import { commandKit, runDirect } from './support/command-kit.ts';
import { call, local, testClock } from './support/core-actions-kit.ts';
import { tenantOf } from './support/generated-kit.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

describe('the generated writes of the core entities', () => {
  test('an update or set that changes backend, app or placement is refused and names core.tenant.move', async () => {
    const { adapter } = commandKit();
    for (const [action, input] of [
      ['core.tenant.update', { id: 'x', ifVersion: 1, backendId: 'other' }],
      ['core.tenant.update', { id: 'x', ifVersion: 1, placement: 'other' }],
      ['core.tenant.set', { id: 'x', backendId: 'other', name: 'n', domains: [] }],
      ['core.backend.update', { id: 'x', ifVersion: 1, app: 'other' }],
      ['core.backend.update', { id: 'x', ifVersion: 1, placement: 'other' }],
    ] as const) {
      const error = await runDirect({ adapter, action, input }).catch((caught: unknown) => caught);
      expect(error, action).toMatchObject({
        kind: 'not_implemented',
        code: 'core.not_implemented',
        message: expect.stringContaining('core.tenant.move'),
      });
    }
  });

  test('a generated update of a backend does not change its configuration', async () => {
    const runtime = await boot(deploymentOf('memory'), { clock: testClock().clock });
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const before = await call(runtime.invoker, local, 'core.backend.get', { ids: [backend.id] });
    expect(before).toMatchObject({ ok: true });
    const refused = await call(runtime.invoker, local, 'core.backend.update', {
      id: backend.id,
      patch: { config: { core: { introspection: 'nonsense' } } },
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: expect.stringContaining('not supported in M1') },
    });
    const after = await call(runtime.invoker, local, 'core.backend.get', { ids: [backend.id] });
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('nonsense');
    expect(JSON.stringify(after)).toContain('library');
  });

  test('the runtime still creates backends and tenants through the generated create', async () => {
    const { runtime, backend, tenant: created } = await tenantOf('memory', 'beta');
    expect(backend.id).toBeTruthy();
    expect(created.id).toBeTruthy();
    const found = await runtime.control.createTenant({ backendId: backend.id, name: 'gamma' });
    expect(found.id).not.toBe(created.id);
  });
});
