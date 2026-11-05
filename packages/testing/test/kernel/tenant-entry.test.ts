import type { Carrier, Runtime } from '@keelwerk/core';
import { renderTypeId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  bearer,
  call,
  issued,
  local,
  ok,
  operatorHost,
  testClock,
} from './support/core-actions-kit.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

const socketOperator = (headers: Record<string, string> = {}): Carrier => ({
  transport: 'test',
  local: { socket: '/run/op.sock' },
  headers,
});
const inProcess = (headers: Record<string, string> = {}): Carrier => ({ ...local, headers });
/** The marker headers of a tenant row id (a UUID) or of text that is no id at all. */
const marker = (tenantId: string, backendId?: string): Record<string, string> => ({
  'x-keelwerk-tenant': tenantId.includes('-') ? renderTypeId('tnt', tenantId) : tenantId,
  ...(backendId === undefined ? {} : { 'x-keelwerk-backend': renderTypeId('bknd', backendId) }),
});

async function started() {
  const time = testClock();
  const runtime: Runtime = await boot(deploymentOf('memory'), { clock: time.clock });
  const backend = await runtime.control.createBackend({
    name: 'library',
    app: 'library',
    placement: 'main',
  });
  const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
  return { time, runtime, backend, tenant };
}

const enter = (runtime: Runtime, tenantId: string, carrier: Carrier = inProcess()) =>
  ok(call(runtime.invoker, carrier, 'core.tenant.enter', { id: tenantId, reason: 'support' }));

const query = (runtime: Runtime, carrier: Carrier) =>
  call(runtime.invoker, carrier, 'library.book.query', {});

describe('the operator enters a tenant (section 8.8)', () => {
  test('after the entry the operator reads the tenant with the marker, and the entry is logged', async () => {
    const { runtime, tenant } = await started();
    await enter(runtime, tenant.id);
    const outcome = await query(runtime, inProcess(marker(tenant.id)));
    expect(outcome).toMatchObject({ ok: true, value: { items: [] } });
  });

  test('a marker without an entry is core.tenant_not_entered', async () => {
    const { runtime, tenant } = await started();
    const outcome = await query(runtime, inProcess(marker(tenant.id)));
    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'forbidden', code: 'core.tenant_not_entered' },
    });
  });

  test('without the marker the session stays at deployment scope', async () => {
    const { runtime, tenant } = await started();
    await enter(runtime, tenant.id);
    const outcome = await query(runtime, inProcess());
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.error.code).not.toBe('core.tenant_not_entered');
  });

  test("another operator's entry does not count", async () => {
    const { runtime, tenant } = await started();
    await enter(runtime, tenant.id, socketOperator());
    expect(await query(runtime, socketOperator(marker(tenant.id)))).toMatchObject({ ok: true });
    expect(await query(runtime, inProcess(marker(tenant.id)))).toMatchObject({
      ok: false,
      error: { code: 'core.tenant_not_entered' },
    });
  });

  test('an entry older than 12 hours does not count, a newer one does', async () => {
    const { runtime, tenant, time } = await started();
    await enter(runtime, tenant.id);
    time.advance({ hours: 11 });
    expect(await query(runtime, inProcess(marker(tenant.id)))).toMatchObject({ ok: true });
    time.advance({ hours: 2 });
    expect(await query(runtime, inProcess(marker(tenant.id)))).toMatchObject({
      ok: false,
      error: { code: 'core.tenant_not_entered' },
    });
    await enter(runtime, tenant.id);
    expect(await query(runtime, inProcess(marker(tenant.id)))).toMatchObject({ ok: true });
  });

  test('an unknown or malformed tenant is not found', async () => {
    const { runtime } = await started();
    for (const id of [crypto.randomUUID(), 'acme', 'tnt_nope']) {
      expect(await query(runtime, inProcess(marker(id)))).toMatchObject({
        ok: false,
        error: { kind: 'not_found' },
      });
    }
  });

  test('a suspended tenant is unavailable', async () => {
    const { runtime, tenant } = await started();
    await enter(runtime, tenant.id);
    await ok(
      call(runtime.invoker, inProcess(), 'core.tenant.update', {
        id: tenant.id,
        patch: { status: 'suspended' },
      }),
    );
    expect(await query(runtime, inProcess(marker(tenant.id)))).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  test('a backend header naming another backend is not found', async () => {
    const { runtime, tenant, backend } = await started();
    await enter(runtime, tenant.id);
    const other = await runtime.control.createBackend({
      name: 'second',
      app: 'library',
      placement: 'main',
    });
    expect(await query(runtime, inProcess(marker(tenant.id, other.id)))).toMatchObject({
      ok: false,
      error: { kind: 'not_found' },
    });
    expect(await query(runtime, inProcess(marker(tenant.id, backend.id)))).toMatchObject({
      ok: true,
    });
  });

  test("an entry of one tenant does not open another's marker", async () => {
    const { runtime, backend, tenant } = await started();
    const other = await runtime.control.createTenant({ backendId: backend.id, name: 'globex' });
    await enter(runtime, tenant.id);
    expect(await query(runtime, inProcess(marker(tenant.id)))).toMatchObject({ ok: true });
    expect(await query(runtime, inProcess(marker(other.id)))).toMatchObject({
      ok: false,
      error: { kind: 'forbidden', code: 'core.tenant_not_entered' },
    });
  });

  test("an operator token holder does not ride on the socket's entry made by another actor", async () => {
    const time = testClock();
    const runtime: Runtime = await boot(
      deploymentOf('memory', { operator: { hosts: [operatorHost] } }),
      { clock: time.clock },
    );
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const { token } = await issued(runtime);
    const holder = (): Carrier => {
      const carrier = bearer(String(token));
      return { ...carrier, headers: { ...carrier.headers, ...marker(tenant.id) } };
    };
    await enter(runtime, tenant.id, socketOperator());
    expect(await query(runtime, holder())).toMatchObject({
      ok: false,
      error: { kind: 'forbidden', code: 'core.tenant_not_entered' },
    });
    await ok(
      call(runtime.invoker, bearer(String(token)), 'core.tenant.enter', {
        id: tenant.id,
        reason: 'support',
      }),
    );
    expect(await query(runtime, holder())).toMatchObject({ ok: true });
  });
});
