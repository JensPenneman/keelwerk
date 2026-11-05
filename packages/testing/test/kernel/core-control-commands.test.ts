import type { DataAdapterFactory } from '@keelwerk/core';
import {
  commandReceiptUuid,
  defineApp,
  defineHook,
  defineModule,
  defineModuleBase,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { vaultApp } from '../../src/fixtures/index.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { call, callWithId, local, ok } from './support/core-actions-kit.ts';
import {
  ada,
  boot,
  deploymentOf,
  factoryOf,
  type Kind,
  app as libraryApp,
} from './support/runtime-kit.ts';

const kinds: readonly Kind[] = ['memory', 'pglite'];

/** An app whose hooks count their runs, so a test sees when the control path ran them. */
function hooked() {
  const calls = { backend: 0, tenant: 0 };
  const base = defineModuleBase({ id: 'hooks', version: '0.1.0' });
  const module = defineModule(base, {
    lifecycle: {
      backendCreated: defineHook(base, 'onBackendCreated', () => {
        calls.backend++;
        return { events: [] };
      }),
      tenantCreated: defineHook(base, 'onTenantCreated', () => {
        calls.tenant++;
        return { events: [] };
      }),
    },
  });
  return { calls, app: withTestResolver(defineApp({ id: 'hooks-app', modules: [module] })) };
}

async function started(kind: Kind) {
  const { calls, app: hooksApp } = hooked();
  const base = factoryOf(kind);
  let deploymentId = '';
  const factory: DataAdapterFactory = {
    ...base,
    create: (placement, env) => {
      deploymentId = env.deploymentId;
      return base.create(placement, env);
    },
  };
  const runtime = await boot(
    deploymentOf(kind, { factory, apps: [libraryApp, hooksApp, withTestResolver(vaultApp)] }),
  );
  const create = {
    backend: (input: Record<string, unknown>, commandId?: string) =>
      commandId === undefined
        ? call(runtime.invoker, local, 'core.backend.create', input)
        : callWithId(runtime.invoker, 'core.backend.create', input, commandId),
    tenant: (input: Record<string, unknown>, commandId?: string) =>
      commandId === undefined
        ? call(runtime.invoker, local, 'core.tenant.create', input)
        : callWithId(runtime.invoker, 'core.tenant.create', input, commandId),
  };
  return { runtime, calls, create, deployment: () => deploymentId };
}

describe.each(kinds)('the control commands over the invoker on %s (S-109)', (kind) => {
  test('creating a backend and a tenant answers the id, resolves at once, runs both hooks and keeps the operator on the receipt', {
    timeout: 60_000,
  }, async () => {
    const { runtime, calls, create, deployment } = await started(kind);
    const backend = await ok(
      create.backend({ name: 'b', app: 'hooks-app', placement: 'main' }, 'c-b'),
    );
    expect(backend).toEqual({ id: expect.any(String) });
    expect(calls).toEqual({ backend: 1, tenant: 0 });
    const tenant = await ok(
      create.tenant({ backendId: backend.id, name: 't', domains: ['t.example.test'] }, 'c-t'),
    );
    expect(calls).toEqual({ backend: 1, tenant: 1 });
    const me = await call(
      runtime.invoker,
      testCarrier({ name: 't', id: tenant.id as string }, ada),
      'core.me',
    );
    expect(me).toMatchObject({ ok: true });
    const receipts = await ok(
      call(runtime.invoker, local, 'core.commandReceipt.get', {
        ids: [commandReceiptUuid(deployment(), 'c-b')],
      }),
    );
    expect(receipts).toMatchObject({
      list: [{ commandId: 'c-b', action: 'core.backend.create', status: 'completed' }],
      notFound: [],
    });
    const stored = (receipts.list as Record<string, unknown>[])[0];
    expect(stored?.principalId).toBe('local.in-process');
  });

  test('the config secrets of a backend are sealed under its key', {
    timeout: 60_000,
  }, async () => {
    const { create, runtime } = await started(kind);
    const backend = await ok(
      create.backend({
        name: 'vault',
        app: 'vault',
        placement: 'main',
        config: { vault: { endpoint: 'https://vault.example', signingKey: 'sign-me-secret' } },
      }),
    );
    const read = await ok(call(runtime.invoker, local, 'core.backend.get', { ids: [backend.id] }));
    const [row] = read.list as Record<string, unknown>[];
    const config = row?.config as Record<string, Record<string, string>>;
    expect(config.vault?.signingKey).toMatch(/^kwc1\./);
    expect(JSON.stringify(row)).not.toContain('sign-me-secret');
  });

  test('refusals: the catalogue, the placement, the version, a suspended backend, a domain clash and a user session', {
    timeout: 60_000,
  }, async () => {
    const { runtime, create } = await started(kind);
    const refused = async (work: ReturnType<typeof create.backend>) => {
      const outcome = await work;
      if (outcome.ok) throw new Error('the create should have been refused');
      return outcome.error;
    };
    expect(
      await refused(create.backend({ name: 'x', app: 'nope', placement: 'main' })),
    ).toMatchObject({ kind: 'validation' });
    expect(
      await refused(create.backend({ name: 'x', app: 'library', placement: 'ghost' })),
    ).toMatchObject({ kind: 'validation' });
    expect(
      await refused(
        create.backend({ name: 'x', app: 'library', placement: 'main', apiVersion: '1999-01-01' }),
      ),
    ).toMatchObject({ kind: 'validation' });
    const backend = await ok(create.backend({ name: 'lib', app: 'library', placement: 'main' }));
    expect(
      await refused(create.backend({ name: 'lib', app: 'library', placement: 'main' })),
    ).toMatchObject({ kind: 'conflict' });
    const tenant = await ok(
      create.tenant({ backendId: backend.id, name: 'a', domains: ['a.example.test'] }),
    );
    expect(
      await refused(
        create.tenant({ backendId: backend.id, name: 'b', domains: ['a.example.test'] }),
      ),
    ).toMatchObject({ kind: 'conflict' });
    const user = testCarrier({ name: 'a', id: tenant.id as string }, ada);
    const asUser = await call(runtime.invoker, user, 'core.backend.create', {
      name: 'u',
      app: 'library',
      placement: 'main',
    });
    expect(asUser).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    await ok(
      call(runtime.invoker, local, 'core.backend.update', {
        id: backend.id,
        patch: { status: 'suspended' },
      }),
    );
    expect(await refused(create.tenant({ backendId: backend.id, name: 'c' }))).toMatchObject({
      kind: 'validation',
    });
  });

  test('a create item of core.tenant.set fails with core.unsupported, since the generated create is off', {
    timeout: 60_000,
  }, async () => {
    const { runtime, create } = await started(kind);
    await ok(create.backend({ name: 'lib', app: 'library', placement: 'main' }));
    const set = await ok(
      call(runtime.invoker, local, 'core.tenant.set', {
        create: [{ name: 'sneaky' }],
      }),
    );
    expect(set.failed).toEqual([
      expect.objectContaining({ operation: 'create', code: 'core.unsupported' }),
    ]);
    expect(set.created).toEqual([]);
  });

  test('the same command id replays with the same id, one row and the hooks once; another input is a mismatch', {
    timeout: 60_000,
  }, async () => {
    const { runtime, calls, create } = await started(kind);
    const input = { name: 'b', app: 'hooks-app', placement: 'main' };
    const first = await ok(create.backend(input, 'once'));
    const again = await ok(create.backend(input, 'once'));
    expect(again.id).toBe(first.id);
    expect(calls.backend).toBe(1);
    const rows = await ok(call(runtime.invoker, local, 'core.backend.query', {}));
    expect((rows.items as unknown[]).length).toBe(1);
    expect(await create.backend({ ...input, name: 'other' }, 'once')).toMatchObject({
      ok: false,
      error: { code: 'core.idempotency_mismatch' },
    });
    const tenantInput = { backendId: first.id, name: 't' };
    const tenant = await ok(create.tenant(tenantInput, 'tenant-once'));
    expect((await ok(create.tenant(tenantInput, 'tenant-once'))).id).toBe(tenant.id);
    expect(calls.tenant).toBe(1);
  });
});
