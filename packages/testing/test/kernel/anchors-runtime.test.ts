import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataAdapter, DataAdapterFactory, LedgerSink, Runtime } from '@keelwerk/core';
import { ledgerFile, readLedger } from '@keelwerk/core/ledger';
import { fallbackReporter, memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { afterEach, describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testSecrets } from '../../src/harness/test-secrets.ts';
import { ada, boot, deploymentOf } from './support/runtime-kit.ts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('anchors through startRuntime', () => {
  test('the heads of the deployment scope written before a stop are in the ledger file, newest last', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-anchors-runtime-'));
    directories.push(directory);
    const path = join(directory, 'ledger.log');
    const deployment = deploymentOf('memory', {
      infrastructure: [
        memoryAdapter(),
        schemaPlanner(),
        fallbackReporter(),
        testSecrets,
        ledgerFile({ path }),
      ],
    });
    const runtime = await boot(deployment);
    await runtime.control.createBackend({ name: 'b', app: 'library', placement: 'main' });
    await runtime.stop(1000);

    const anchors = [];
    for await (const record of readLedger(path)) {
      if (record.type === 'anchor') anchors.push(record);
    }
    expect(anchors.length).toBeGreaterThan(0);
    const positions = anchors.map((record) => Number(record.position));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(anchors.map((record) => record.scopeId)).size).toBe(1);
    expect(anchors.at(-1)?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(anchors.at(-1)?.scopeId).not.toBe('deployment');
  });

  const tenantAnchors = async (path: string, tenantId: string) => {
    const found = [];
    for await (const record of readLedger(path)) {
      if (record.type === 'anchor' && record.scopeId === tenantId) found.push(record);
    }
    return found;
  };

  const addBook = (runtime: Runtime, tenantId: string, isbn: string) =>
    runtime.invoker.invoke({
      action: 'library.addBook',
      input: { title: isbn, isbn },
      carrier: testCarrier({ name: 't', id: tenantId }, ada),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });

  test('a tenant command of a served app is anchored under the tenant by the time the runtime has stopped', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-anchors-runtime-'));
    directories.push(directory);
    const path = join(directory, 'ledger.log');
    const runtime = await boot(
      deploymentOf('memory', {
        infrastructure: [
          memoryAdapter(),
          schemaPlanner(),
          fallbackReporter(),
          testSecrets,
          ledgerFile({ path }),
        ],
      }),
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    expect(await addBook(runtime, tenant.id, 'isbn-runtime-1')).toMatchObject({ ok: true });
    await runtime.stop(1000);
    const anchors = await tenantAnchors(path, tenant.id);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.at(-1)?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('heads committed while no process ran are anchored at the next start', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-anchors-runtime-'));
    directories.push(directory);
    const path = join(directory, 'ledger.log');
    // Adapters that outlive the runtime: closing them is a no-op, so a second runtime finds the data.
    const kept = new Map<string, DataAdapter>();
    const inner = memoryAdapter();
    const factory: DataAdapterFactory = {
      ...inner,
      create: (placement, env) => {
        const held = kept.get(placement.id) ?? inner.create(placement, env);
        kept.set(placement.id, held);
        return { ...held, close: async () => undefined };
      },
    };
    const first = await boot(deploymentOf('memory', { factory }));
    const backend = await first.control.createBackend({
      name: 'b',
      app: 'library',
      placement: 'main',
    });
    const tenant = await first.control.createTenant({ backendId: backend.id, name: 't' });
    expect(await addBook(first, tenant.id, 'isbn-runtime-2')).toMatchObject({ ok: true });
    await first.stop(1000);
    expect(await tenantAnchors(path, tenant.id)).toEqual([]);

    const second = await boot(
      deploymentOf('memory', {
        infrastructure: [
          factory,
          schemaPlanner(),
          fallbackReporter(),
          testSecrets,
          ledgerFile({ path }),
        ],
      }),
    );
    await second.stop(1000);
    expect((await tenantAnchors(path, tenant.id)).length).toBeGreaterThan(0);
  });

  test('a sink that refuses the appends shows in the control reader: count and last failure', async () => {
    const refusing: LedgerSink = {
      id: 'refusing',
      append: async () => {
        throw new Error('read-only volume');
      },
      read: async function* () {},
    };
    const runtime = await boot(
      deploymentOf('memory', {
        infrastructure: [
          memoryAdapter(),
          schemaPlanner(),
          fallbackReporter(),
          testSecrets,
          refusing,
        ],
      }),
    );
    await runtime.control.createBackend({ name: 'b', app: 'library', placement: 'main' });
    await runtime.stop(1000);
    const [status] = runtime.control.anchorSinks?.() ?? [];
    expect(status?.sink).toBe('refusing');
    expect(status?.refusedAppends).toBeGreaterThan(0);
    expect(status?.lastFailure?.message).toBe('read-only volume');
  });
});
