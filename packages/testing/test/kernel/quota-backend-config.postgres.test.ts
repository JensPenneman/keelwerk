import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { bootQuotas, followQuotas, setQuota, storedBackends } from './support/quota-kit.ts';
import { asOperator } from './support/targeting-kit.ts';

const mebibyte = 1024 * 1024;
const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.map((stop) => stop()));
});

test('on PostgreSQL the backend configuration holds the quota values, the reader pages them, and the tenant bound and the creation check refuse as on the memory store', {
  timeout: 180_000,
}, async () => {
  const database = await createTestDatabase('quota_backend_config');
  const runtime = await bootQuotas({
    external: {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    },
    config: { core: { quotas: { 'notes.noteBytes': '4MiB', 'queue:commands.weight': '3' } } },
  });
  stops.push(() => runtime.stop());
  const { limits } = followQuotas(runtime);
  const registry = runtime.app.registry;
  const view = await limits.fresh();
  const acme = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  expect(view.limitOf(registry, acme, 'notes.noteBytes')).toEqual({
    kind: 'bytes',
    value: 4 * mebibyte,
  });
  expect(view.queueOf(acme, 'commands').weight).toBe(3);
  const [backend] = await storedBackends(runtime);
  expect(backend?.config).toEqual({
    core: { quotas: { 'notes.noteBytes': '4194304', 'queue:commands.weight': '3' } },
  });
  // The tenant bound is the configured value, not the default.
  const tenant = { backendId: runtime.backendId, tenantId: runtime.tenants.acme.id };
  expect(
    await setQuota(runtime, {
      ...tenant,
      dimension: 'notes.noteBytes',
      limit: '5MiB',
      reason: 'x',
    }),
  ).toMatchObject({ ok: false, error: { kind: 'validation', code: 'core.malformed_request' } });
  expect(
    await setQuota(runtime, {
      ...tenant,
      dimension: 'notes.noteBytes',
      limit: '4MiB',
      reason: 'x',
    }),
  ).toMatchObject({ ok: true });
  // A set without a tenant is refused and writes no row.
  expect(
    await setQuota(runtime, {
      backendId: runtime.backendId,
      dimension: 'queue:commands.weight',
      limit: '2',
      reason: 'x',
    }),
  ).toMatchObject({ ok: false, error: { kind: 'validation' } });
  // A bad member refuses the backend and none of that name exists.
  const refused = await asOperator(runtime, 'core.backend.create', {
    name: 'broken',
    app: 'quota-app',
    placement: 'main',
    config: { core: { quotas: { 'queue:commands.weight': '0' } } },
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect((await storedBackends(runtime)).map((row) => row.name)).toEqual(['test']);
});
