import { newUuidV7 } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import {
  bootQuotas,
  callNotesAs,
  followQuotas,
  setQuota,
  storedQuota,
} from './support/quota-kit.ts';
import { asOperator } from './support/targeting-kit.ts';

const mebibyte = 1024 * 1024;
const bytes = (value: number) => ({ kind: 'bytes', value });
const waitFor = { timeout: 10_000 } as const;

type Booted = Awaited<ReturnType<typeof bootQuotas>>;

function tenantScope(runtime: Booted, tenant: 'acme' | 'globex') {
  return {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants[tenant].id,
  } as const;
}

async function mustSet(runtime: Booted, input: Record<string, unknown>) {
  const set = await setQuota(runtime, input);
  if (!set.ok) throw set.error;
  return set.value;
}

describe('core.quota.set', () => {
  test("an operator sets a tenant's value and the cache resolves it under the backend's configured value", async () => {
    const runtime = await bootQuotas({
      config: { core: { quotas: { 'notes.noteBytes': '4MiB' } } },
    });
    const { limits } = followQuotas(runtime);
    const registry = runtime.app.registry;
    await mustSet(runtime, {
      dimension: 'notes.noteBytes',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      limit: '2MiB',
      reason: 'a trial tenant',
    });
    await limits.fresh();
    expect(limits.limitOf(registry, tenantScope(runtime, 'acme'), 'notes.noteBytes')).toEqual(
      bytes(2 * mebibyte),
    );
    expect(limits.limitOf(registry, tenantScope(runtime, 'globex'), 'notes.noteBytes')).toEqual(
      bytes(4 * mebibyte),
    );
    expect(
      limits.limitOf(
        registry,
        { level: 'backend', backendId: runtime.backendId },
        'notes.noteBytes',
      ),
    ).toEqual(bytes(4 * mebibyte));
    expect(limits.limitOf(registry, { level: 'deployment' }, 'notes.noteBytes')).toEqual(
      bytes(mebibyte),
    );
  });

  test('a tenant value is stored in its canonical form, never the typed text', async () => {
    const runtime = await bootQuotas();
    const set = await mustSet(runtime, {
      dimension: 'notes.noteBytes',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      limit: '0.5MiB',
      reason: 'half',
    });
    expect((await storedQuota(runtime, set.id)).row).toMatchObject({ limit: '524288' });
    const rate = await mustSet(runtime, {
      dimension: 'core.requestRate',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      limit: '10/PT1M',
      reason: 'slow',
    });
    expect((await storedQuota(runtime, rate.id)).row).toMatchObject({ limit: '10/60000ms' });
  });

  test('limit default removes the override and the backend value serves again', async () => {
    const runtime = await bootQuotas({
      config: { core: { quotas: { 'notes.noteBytes': '4MiB' } } },
    });
    const { limits } = followQuotas(runtime);
    const registry = runtime.app.registry;
    const base = {
      dimension: 'notes.noteBytes',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    };
    const first = await mustSet(runtime, { ...base, limit: '2MiB', reason: 'trial' });
    await limits.fresh();
    const acme = tenantScope(runtime, 'acme');
    expect(limits.limitOf(registry, acme, 'notes.noteBytes')).toEqual(bytes(2 * mebibyte));
    expect(await mustSet(runtime, { ...base, limit: 'default', reason: 'back' })).toEqual({
      id: first.id,
      version: 2,
    });
    await vi.waitFor(
      () => expect(limits.limitOf(registry, acme, 'notes.noteBytes')).toEqual(bytes(4 * mebibyte)),
      waitFor,
    );
    const stored = await storedQuota(runtime, first.id);
    expect(stored.row).toMatchObject({ version: 2 });
    expect(stored.row?.limit ?? null).toBeNull();
    // A first `default` creates the row without a limit, so the reason stays in the history.
    const created = await mustSet(runtime, {
      dimension: 'core.rows',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.globex.id,
      limit: 'default',
      reason: 'documented',
    });
    expect(created.version).toBe(1);
    expect((await storedQuota(runtime, created.id)).row?.limit ?? null).toBeNull();
  });

  test('the same limit and reason again writes nothing', async () => {
    const runtime = await bootQuotas();
    const input = {
      dimension: 'notes.noteBytes',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      limit: '512KiB',
      reason: 'plan',
    };
    const first = await mustSet(runtime, input);
    expect(await mustSet(runtime, input)).toEqual(first);
    const stored = await storedQuota(runtime, first.id);
    expect(stored.row).toMatchObject({ version: 1 });
    expect(stored.events).toHaveLength(1);
    // Another reason with the same limit is a change.
    expect(await mustSet(runtime, { ...input, reason: 'plan, renewed' })).toEqual({
      id: first.id,
      version: 2,
    });
    expect((await storedQuota(runtime, first.id)).events).toHaveLength(2);
  });

  test('a tenant principal calling core.quota.set is forbidden', async () => {
    const runtime = await bootQuotas();
    const outcome = await callNotesAs(runtime, 'acme', 'core.quota.set', {
      dimension: 'notes.noteBytes',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      limit: '2MiB',
      reason: 'try',
    });
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    const rows = await asOperator(runtime, 'core.quota.query', {});
    expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
  });

  test("an operator's tenant row above the backend's value is refused with core.malformed_request", async () => {
    const runtime = await bootQuotas();
    const refused = { ok: false, error: { kind: 'validation', code: 'core.malformed_request' } };
    const tenant = { backendId: runtime.backendId, tenantId: runtime.tenants.acme.id };
    // A limit: the declared default is the backend's value unless its configuration says otherwise.
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'notes.noteBytes',
        limit: '2MiB',
        reason: 'raise',
      }),
    ).toMatchObject(refused);
    // A cap and a weight: the deployment's queue limits are the backend's values.
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'queue:commands.running',
        limit: '5',
        reason: 'raise',
      }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'queue:commands.weight',
        limit: '2',
        reason: 'raise',
      }),
    ).toMatchObject(refused);
    // Below the backend's value is allowed.
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'queue:commands.weight',
        limit: '1',
        reason: 'equal',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await setQuota(runtime, {
        ...tenant,
        dimension: 'core.rows',
        limit: '10000001',
        reason: 'raise',
      }),
    ).toMatchObject(refused);
  });

  test('an undeclared dimension, an unknown queue, a limit the kind refuses and a tenant that is not the backends are refused, and nothing is stored', async () => {
    const runtime = await bootQuotas();
    const refused = { ok: false, error: { kind: 'validation', code: 'core.malformed_request' } };
    const base = {
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      reason: 'try',
    };
    const stranger = newUuidV7();
    expect(
      await setQuota(runtime, { ...base, dimension: 'notes.nothing', limit: '1' }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, { ...base, dimension: 'queue:ghost.running', limit: '1' }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, { ...base, dimension: 'queue:commands.sleep', limit: '1' }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, { ...base, dimension: 'notes.noteBytes', limit: 'lots' }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, { ...base, dimension: 'core.rows', limit: '1.5' }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, {
        ...base,
        dimension: 'core.requestRate',
        limit: '0/1m',
      }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, {
        ...base,
        dimension: 'notes.noteBytes',
        tenantId: stranger,
        limit: '1MiB',
      }),
    ).toMatchObject(refused);
    expect(
      await setQuota(runtime, {
        dimension: 'notes.noteBytes',
        backendId: newUuidV7(),
        tenantId: runtime.tenants.acme.id,
        limit: '1MiB',
        reason: 'try',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    const rows = await asOperator(runtime, 'core.quota.query', {});
    expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
  });

  test('a dimension counted at backend level has no row: its value is configuration', async () => {
    const runtime = await bootQuotas();
    const refused = { ok: false, error: { kind: 'validation', code: 'core.malformed_request' } };
    expect(
      await setQuota(runtime, {
        dimension: 'notes.backendNotes',
        backendId: runtime.backendId,
        tenantId: runtime.tenants.acme.id,
        limit: '10',
        reason: 'try',
      }),
    ).toMatchObject(refused);
    const rows = await asOperator(runtime, 'core.quota.query', {});
    expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
  });

  test('core.quota.set, get, query and history are registered', async () => {
    const runtime = await bootQuotas();
    for (const ref of [
      'core.quota.set',
      'core.quota.get',
      'core.quota.query',
      'core.quota.history',
    ]) {
      expect(runtime.app.registry.actions.has(ref)).toBe(true);
    }
    for (const ref of ['core.quota.create', 'core.quota.update']) {
      expect(runtime.app.registry.actions.has(ref)).toBe(false);
    }
  });
});
