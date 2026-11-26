import { defineApiVersions, defineApp, selfErase } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { createLocalClient, startTestRuntime } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { describe, expect, onTestFinished, test } from 'vitest';
import { apiKeys } from '../src/module.generated.ts';
import { keyOwner, keyOwnerSubject } from './support/api-key-calls.ts';
import { later } from './support/later/module.ts';

const api = defineApiVersions({
  '2026-11-04': { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
  '2026-11-11': {},
});
const selfErasing = defineApp({
  id: 'keys',
  modules: [apiKeys, library, loans, later] as const,
  api,
  policies: { add: [selfErase] },
});
const bootedAt = Temporal.Instant.from('2026-11-20T09:00:00Z');

async function run(app: typeof selfErasing, scopes: readonly string[]) {
  const worker = erasure({ pollMs: 3_600_000 });
  let now = bootedAt;
  const runtime = await startTestRuntime(app, {
    adapter: 'memory',
    tenants: ['acme'],
    clock: { now: () => now },
    workers: true,
    eventWorkers: [worker],
  });
  onTestFinished(() => runtime.stop());
  const created = await createLocalClient(runtime, { principal: keyOwner, tenant: 'acme' }).attempt(
    'api-keys.create',
    { label: 'laptop', scopes },
  );
  if (!created.ok) throw created.error;
  const { key } = created.value as { key: string };
  const commandId = crypto.randomUUID();
  const sent = await runtime.invoker.invoke({
    action: 'core.eraseSubject',
    input: { subjectId: keyOwnerSubject, reason: 'subjectRequest' },
    carrier: {
      transport: 'test',
      headers: { 'x-tenant': runtime.tenants.acme.id, authorization: `Bearer ${key}` },
      connection: {
        id: 'c1',
        listener: 'http',
        remote: { address: '203.0.113.7', port: 40000 },
        local: { address: '127.0.0.1', port: 8080 },
      },
    },
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
    commandId,
    prefer: 'async',
  });
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const receipt = () =>
    runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.receipts.get(commandId));
  const ledger = async () =>
    (
      await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
        { readOnly: true },
      )
    ).map((entry) => (entry.record as { type: string }).type);
  const accepted = { ok: sent.ok, status: (await receipt())?.status };
  for (let day = 0; day < 4; day += 1) {
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
    now = now.add({ hours: 24 });
    await runtime.advanceTo(now);
  }
  await runtime.drainJobs();
  await worker.pass();
  const after = { status: (await receipt())?.status, ledger: await ledger() };
  return { accepted, after };
}

describe('a user erases themselves with an API key', () => {
  test('a key that may write: the accepted erasure runs to its end, whatever the read-only rule says of keys', async () => {
    const { accepted, after } = await run(selfErasing, ['read', 'write']);
    expect(accepted).toEqual({ ok: true, status: 'accepted' });
    expect(after.ledger).toContain('erasure');
    expect(after.status).toBe('completed');
  });
});
