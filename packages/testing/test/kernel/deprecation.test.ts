import type { Carrier, Clock } from '@keelwerk/core';
import { defineApiVersions, defineApp } from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { library } from '../../src/fixtures/index.ts';
import { pinnedLiveTimers } from '../../src/harness/pinned-live-timers.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';

const older = '2026-11-04';
const head = '2026-11-11';
const app = defineApp({
  id: 'deprecating',
  modules: [library],
  api: defineApiVersions({
    [older]: { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
    [head]: {},
  }),
});

let now = Temporal.Instant.from('2026-11-09T10:00:00Z');
const clock: Clock = { now: () => now };
const timers = pinnedLiveTimers(clock);
const advanceTo = (at: string): void => {
  now = Temporal.Instant.from(at);
};

const operator: Carrier = { transport: 'test', local: { inProcess: true } };
type Started = Awaited<ReturnType<typeof boot>>;

async function boot() {
  return startTestRuntime(app, {
    operators: true,
    clock,
    timers,
    host: httpHost(),
    tenants: ['acme'],
    tenantApiVersions: { acme: older },
  });
}

let runtime: Started;
beforeAll(async () => {
  runtime = await boot();
});
afterAll(() => runtime.stop());

function invoke(headers: Record<string, string> = {}): Promise<Response> {
  return runtime.fetch(
    new Request('https://deprecating.example.test/_keelwerk/v1/invoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant': runtime.tenants.acme.id,
        [testPrincipalHeader]: JSON.stringify(testPrincipal('zoe-quill')),
        ...headers,
      },
      body: JSON.stringify({ action: 'library.findByIsbn', input: { isbn: '978-0' } }),
    }),
  );
}

function asOperator(action: string, input: unknown) {
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier: operator,
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

async function usage(): Promise<readonly Record<string, unknown>[]> {
  const outcome = await asOperator('core.apiUsage', { since: '2026-11-01', until: '2026-12-31' });
  if (!outcome.ok) throw outcome.error;
  return outcome.value.items as readonly Record<string, unknown>[];
}

describe('deprecated API versions (section 18.5)', () => {
  test('before its deprecation date the version answers without the three headers', async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('keelwerk-version')).toBe(older);
    expect(response.headers.get('deprecation')).toBeNull();
    expect(response.headers.get('sunset')).toBeNull();
    expect(response.headers.get('link')).toBeNull();
  });

  test('a deprecated version answers with Deprecation @<seconds of at>, the Sunset HTTP-date and the capabilities Link (RFC 9745, RFC 8594)', async () => {
    advanceTo('2026-11-12T10:00:00Z');
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('deprecation')).toBe('@1794268800');
    // The sunset date is the last day served: the header names the first instant that is not.
    expect(response.headers.get('sunset')).toBe('Wed, 02 Dec 2026 00:00:00 GMT');
    expect(response.headers.get('link')).toBe('</_keelwerk/v1/capabilities>; rel="deprecation"');
    const current = await invoke({ 'keelwerk-version': head });
    expect(current.headers.get('keelwerk-version')).toBe(head);
    expect(current.headers.get('deprecation')).toBeNull();
  });

  test('requests are counted per day, backend, tenant, version and transport and flushed once per minute', {
    timeout: 120_000,
  }, async () => {
    const mine = async () => (await usage()).filter((row) => row.backendId === runtime.backendId);
    const countOf = async (version: string) =>
      Number((await mine()).find((row) => row.apiVersion === version)?.count ?? 0);
    // The earlier requests are flushed by the first wait that the clock has passed.
    advanceTo('2026-11-12T11:00:00Z');
    await timers.fire();
    await vi.waitFor(
      async () => {
        expect([await countOf(older), await countOf(head)]).toEqual([2, 1]);
      },
      { timeout: 60_000 },
    );
    await invoke();
    await invoke();
    await invoke({ 'keelwerk-version': head });
    now = now.add({ seconds: 59 });
    await timers.fire();
    expect([await countOf(older), await countOf(head)]).toEqual([2, 1]);
    now = now.add({ seconds: 2 });
    await vi.waitFor(
      async () => {
        await timers.fire();
        expect([await countOf(older), await countOf(head)]).toEqual([4, 2]);
      },
      { timeout: 60_000 },
    );
    expect((await mine()).find((row) => row.apiVersion === older)).toMatchObject({
      tenantId: runtime.tenants.acme.id,
      item: '',
      transport: 'http',
      firstDay: '2026-11-09',
      lastDay: '2026-11-12',
    });
    // The next day is a new row.
    advanceTo('2026-11-13T10:00:00Z');
    await timers.fire();
    await invoke();
    now = now.add({ seconds: 61 });
    await vi.waitFor(
      async () => {
        await timers.fire();
        expect(
          (await mine()).filter((row) => row.apiVersion === older).map((row) => row.lastDay),
        ).toContain('2026-11-13');
      },
      { timeout: 60_000 },
    );
  });

  test('kw_api_usage holds no address and no principal id', async () => {
    const rows = await usage();
    expect(rows.length).toBeGreaterThan(0);
    const allowed = new Set([runtime.backendId, runtime.tenants.acme.id]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'apiVersion',
        'backendId',
        'count',
        'firstDay',
        'item',
        'lastDay',
        'tenantId',
        'transport',
      ]);
      expect(typeof row.transport).toBe('string');
      expect(String(row.transport)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      // The subject is no run of hex digits, so no random id can hold it by chance.
      expect(JSON.stringify(row)).not.toContain('zoe-quill');
      if (row.backendId === runtime.backendId) {
        expect(allowed.has(String(row.tenantId))).toBe(true);
      }
    }
  });

  test('retire is refused before the sunset (409 core.conflict)', async () => {
    const outcome = await asOperator('core.retireApiVersion', {
      app: 'deprecating',
      version: older,
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'core.conflict' },
    });
  });

  test('after the sunset and before any retire a pinned tenant is served under the target, and the version in the header answers 410', async () => {
    advanceTo('2026-12-02T10:00:00Z');
    const pinned = await invoke();
    expect(pinned.status).toBe(200);
    expect(pinned.headers.get('keelwerk-version')).toBe(head);
    expect(pinned.headers.get('deprecation')).toBeNull();
    const asked = await invoke({ 'keelwerk-version': older });
    expect(asked.status).toBe(410);
    expect(((await asked.json()) as { error: { code: string } }).error.code).toBe(
      'core.api_version_retired',
    );
  });

  test('after the sunset retire re-pins the tenant below the floor by a core.tenant.repinApiVersion event, and its pin names the floor afterwards', async () => {
    const outcome = await asOperator('core.retireApiVersion', {
      app: 'deprecating',
      version: older,
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: { app: 'deprecating', version: older, floor: head, tenants: 1, backends: 0 },
    });
    const events = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.events.readStream({ type: 'core.tenant', id: runtime.tenants.acme.id }),
      { readOnly: true },
    );
    expect(events.map((event) => event.action)).toContain('core.tenant.repinApiVersion');
    const tenants = await asOperator('core.tenant.query', {});
    if (!tenants.ok) throw tenants.error;
    expect(
      (tenants.value.items as readonly { id: string; apiVersion: string }[]).find(
        (tenant) => tenant.id === runtime.tenants.acme.id,
      )?.apiVersion,
    ).toBe(head);
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('keelwerk-version')).toBe(head);
    expect(response.headers.get('deprecation')).toBeNull();
  });

  test('a second retire re-pins nothing', async () => {
    const outcome = await asOperator('core.retireApiVersion', {
      app: 'deprecating',
      version: older,
    });
    expect(outcome).toMatchObject({ ok: true, value: { floor: head, tenants: 0, backends: 0 } });
  });
});
