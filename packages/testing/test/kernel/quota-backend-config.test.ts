import { describe, expect, test, vi } from 'vitest';
import { bootQuotas, followQuotas, setQuota, storedBackends } from './support/quota-kit.ts';
import { asOperator } from './support/targeting-kit.ts';

const mebibyte = 1024 * 1024;
const bytes = (value: number) => ({ kind: 'bytes', value });
const withQuotas = (quotas: unknown) => ({ core: { quotas } });

type Booted = Awaited<ReturnType<typeof bootQuotas>>;

function tenantScope(runtime: Booted, tenant: 'acme' | 'globex') {
  return {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants[tenant].id,
  } as const;
}

function createBackend(runtime: Booted, name: string, config: unknown) {
  return asOperator(runtime, 'core.backend.create', {
    name,
    app: 'quota-app',
    placement: 'main',
    config,
  });
}

describe('config.core.quotas of a backend', () => {
  test('a backend created with a quota value stores it and the cache reads it at backend scope and for a tenant without a row', async () => {
    const runtime = await bootQuotas({ config: withQuotas({ 'notes.noteBytes': '4MiB' }) });
    const { limits } = followQuotas(runtime);
    const registry = runtime.app.registry;
    const view = await limits.fresh();
    expect(
      view.limitOf(registry, { level: 'backend', backendId: runtime.backendId }, 'notes.noteBytes'),
    ).toEqual(bytes(4 * mebibyte));
    expect(view.limitOf(registry, tenantScope(runtime, 'acme'), 'notes.noteBytes')).toEqual(
      bytes(4 * mebibyte),
    );
    expect(view.limitOf(registry, { level: 'deployment' }, 'notes.noteBytes')).toEqual(
      bytes(mebibyte),
    );
    // Stored in its canonical form.
    const [backend] = await storedBackends(runtime);
    expect(backend?.config).toEqual({ core: { quotas: { 'notes.noteBytes': '4194304' } } });
  });

  test('a queue member set in the configuration is resolved by queueOf', async () => {
    const runtime = await bootQuotas({
      config: withQuotas({ 'queue:commands.running': '7', 'queue:commands.weight': '3' }),
    });
    const { limits } = followQuotas(runtime);
    const view = await limits.fresh();
    expect(view.queueOf(tenantScope(runtime, 'acme'), 'commands')).toEqual({
      running: 7,
      queued: 10_000,
      weight: 3,
    });
    expect(view.queueOf(tenantScope(runtime, 'acme'), 'reactions')).toEqual({
      running: 4,
      queued: 10_000,
      weight: 1,
    });
  });

  test('a queue member at the integer bound is accepted in the configuration', async () => {
    const runtime = await bootQuotas({
      config: withQuotas({
        'queue:commands.running': '2147483647',
        'queue:commands.weight': '2147483647',
      }),
    });
    const { limits } = followQuotas(runtime);
    const view = await limits.fresh();
    expect(view.queueOf(tenantScope(runtime, 'acme'), 'commands')).toEqual({
      running: 2_147_483_647,
      queued: 10_000,
      weight: 2_147_483_647,
    });
  });

  test('a backend created later reaches a running cache through the feed wake', async () => {
    const runtime = await bootQuotas();
    const { limits } = followQuotas(runtime);
    const registry = runtime.app.registry;
    const view = await limits.fresh();
    const created = await createBackend(
      runtime,
      'later',
      withQuotas({ 'notes.noteBytes': '8MiB' }),
    );
    if (!created.ok) throw created.error;
    const later = { level: 'backend', backendId: created.value.id as string } as const;
    await vi.waitFor(() =>
      expect(view.limitOf(registry, later, 'notes.noteBytes')).toEqual(bytes(8 * mebibyte)),
    );
  });

  test('a bad member refuses the backend with the issue at its path and no backend of that name exists', async () => {
    const runtime = await bootQuotas();
    const cases: [string, unknown, string][] = [
      ['unknown', { 'core.nope': '1' }, 'core.nope'],
      ['unparsable', { 'notes.noteBytes': 'lots' }, 'notes.noteBytes'],
      ['default', { 'notes.noteBytes': 'default' }, 'notes.noteBytes'],
      ['zero-weight', { 'queue:commands.weight': '0' }, 'queue:commands.weight'],
      ['too-many', { 'queue:commands.running': '2147483648' }, 'queue:commands.running'],
      ['ghost-queue', { 'queue:ghosts.running': '1' }, 'queue:ghosts.running'],
    ];
    for (const [name, quotas, dimension] of cases) {
      const refused = await createBackend(runtime, name, withQuotas(quotas));
      expect(refused, name).toMatchObject({ ok: false, error: { kind: 'validation' } });
      expect(JSON.stringify(refused), name).toContain(`"core","quotas","${dimension}"`);
    }
    const notAnObject = await createBackend(runtime, 'text', withQuotas('4MiB'));
    expect(notAnObject).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect((await storedBackends(runtime)).map((row) => row.name)).toEqual(['test']);
  });

  test('a backend with no configuration, and one with only introspection, read the defaults', async () => {
    for (const config of [undefined, { core: { introspection: 'public' } }]) {
      const runtime = await bootQuotas(config === undefined ? {} : { config });
      const { limits } = followQuotas(runtime);
      const view = await limits.fresh();
      expect(
        view.limitOf(runtime.app.registry, tenantScope(runtime, 'acme'), 'notes.noteBytes'),
      ).toEqual(bytes(mebibyte));
      expect(view.queueOf(tenantScope(runtime, 'acme'), 'commands').weight).toBe(1);
    }
  });

  test("a tenant value above the backend's configured value is refused and a value equal to it passes", async () => {
    const runtime = await bootQuotas({ config: withQuotas({ 'notes.noteBytes': '4MiB' }) });
    const tenant = { backendId: runtime.backendId, tenantId: runtime.tenants.acme.id };
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'notes.noteBytes',
        limit: '5MiB',
        reason: 'raise',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation', code: 'core.malformed_request' } });
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'notes.noteBytes',
        limit: '4MiB',
        reason: 'equal',
      }),
    ).toMatchObject({ ok: true });
  });
});
