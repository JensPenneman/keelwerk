import { expect, test, vi } from 'vitest';
import { bootQuotas, followQuotas, setQuota, storedQuota } from './support/quota-kit.ts';

const mebibyte = 1024 * 1024;

// The embedded database boots and takes several writes here: under a loaded machine that passes five seconds.
test('on the embedded SQL adapter core.quota rows are written, read back by ControlQuotas.rows(), the backend configuration is read by readBackendQuotas, and the cache follows both', async () => {
  const runtime = await bootQuotas({
    adapter: 'pglite',
    config: { core: { quotas: { 'notes.noteBytes': '4MiB' } } },
  });
  const { limits } = followQuotas(runtime);
  const registry = runtime.app.registry;
  const base = {
    dimension: 'notes.noteBytes',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const tenant = await setQuota(runtime, { ...base, limit: '2MiB', reason: 'trial' });
  if (!tenant.ok) throw tenant.error;
  // The `limit` column and the tenant reference are stored and read back as written (canonical).
  expect((await storedQuota(runtime, tenant.value.id)).row).toMatchObject({
    slot: `notes.noteBytes@${runtime.backendId}@${runtime.tenants.acme.id}`,
    tenantId: runtime.tenants.acme.id,
    limit: String(2 * mebibyte),
    version: 1,
  });
  const view = await limits.fresh();
  const acme = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const globex = { ...acme, tenantId: runtime.tenants.globex.id } as const;
  expect(view.limitOf(registry, acme, 'notes.noteBytes')).toEqual({
    kind: 'bytes',
    value: 2 * mebibyte,
  });
  expect(view.limitOf(registry, globex, 'notes.noteBytes')).toEqual({
    kind: 'bytes',
    value: 4 * mebibyte,
  });
  // A cleared limit reads as null and the backend's value serves again; the feed carries the change.
  const cleared = await setQuota(runtime, { ...base, limit: 'default', reason: 'ended' });
  expect(cleared).toMatchObject({ ok: true, value: { version: 2 } });
  await vi.waitFor(
    () =>
      expect(view.limitOf(registry, acme, 'notes.noteBytes')).toEqual({
        kind: 'bytes',
        value: 4 * mebibyte,
      }),
    { timeout: 10_000 },
  );
}, 60_000);
