import { describe, expect, test } from 'vitest';
import type { AdmissionRun } from '../admission/run-admission.ts';
import { createControlApiUsage } from '../control/create-control-api-usage.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { ApiUsageCount, ApiUsageStore } from '../storage/api-usage-store.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';
import { countApiUsage } from './count-api-usage.ts';

const now = Temporal.Instant.from('2026-11-12T10:00:00Z');
const deploymentId = '00000000-0000-4000-8000-0000000000d1';
const backendId = '00000000-0000-4000-8000-0000000000b1';
const tenantId = '00000000-0000-4000-8000-0000000000a1';
const namespace = { id: 'ns-control' } as NamespaceRef;

/** A control adapter whose usage table is a list. */
function fakeControl(): { adapter: DataAdapter; rows: ApiUsageCount[] } {
  const rows: ApiUsageCount[] = [];
  const store: ApiUsageStore = {
    add: async (counts) => {
      rows.push(...counts);
    },
    totals: async () => [],
  };
  const adapter = {
    unit: async (_ns: NamespaceRef, _scope: unknown, fn: (unit: Unit) => Promise<unknown>) =>
      fn({ apiUsage: store } as unknown as Unit),
  } as unknown as DataAdapter;
  return { adapter, rows };
}

function envOf(usage: ReturnType<typeof createControlApiUsage> | undefined): InvokerEnv {
  return {
    options: {
      clock: { now: () => now },
      log: { warn: () => undefined },
      ...(usage === undefined ? {} : { apiUsage: usage }),
    },
  } as unknown as InvokerEnv;
}

function runOf(over: {
  deprecated?: { reason: string; at?: string };
  dry?: boolean;
  job?: boolean;
  scope?: AdmissionRun['session']['scope'];
}): AdmissionRun {
  return {
    action: { ref: 'library.book.list', deprecated: over.deprecated },
    session: {
      scope: over.scope ?? { level: 'tenant', backendId, tenantId },
      apiVersion: '2026-11-04',
    },
    details: { carrier: { transport: 'rest', ...(over.job === true ? { job: {} } : {}) } },
    ...(over.dry === undefined ? {} : { dry: over.dry }),
  } as unknown as AdmissionRun;
}

function usageOf(adapter: DataAdapter) {
  return createControlApiUsage({ adapter, namespace, clock: { now: () => now }, deploymentId });
}

describe('countApiUsage (section 18.5, S-144)', () => {
  test('an action whose at carries a time counts from the start of that UTC day', async () => {
    const { adapter, rows } = fakeControl();
    const usage = usageOf(adapter);
    await countApiUsage(
      envOf(usage),
      runOf({ deprecated: { reason: 'old', at: '2026-11-12T23:30:00Z' } }),
    );
    await countApiUsage(
      envOf(usage),
      runOf({ deprecated: { reason: 'later', at: '2026-11-13T00:00:00Z' } }),
    );
    await usage.flush();
    expect(rows.map((row) => [row.item, row.count])).toEqual([
      ['', 2],
      ['library.book.list', 1],
    ]);
  });

  test('an action deprecated without at counts from its declaration', async () => {
    const { adapter, rows } = fakeControl();
    const usage = usageOf(adapter);
    await countApiUsage(envOf(usage), runOf({ deprecated: { reason: 'old' } }));
    await usage.flush();
    expect(rows.map((row) => [row.item, row.count])).toEqual([
      ['', 1],
      ['library.book.list', 1],
    ]);
  });

  test('records the version total, and the head ref of a deprecated action', async () => {
    const { adapter, rows } = fakeControl();
    const usage = usageOf(adapter);
    await countApiUsage(envOf(usage), runOf({}));
    await countApiUsage(envOf(usage), runOf({ deprecated: { reason: 'old', at: '2026-11-12' } }));
    await countApiUsage(envOf(usage), runOf({ deprecated: { reason: 'later', at: '2026-11-13' } }));
    expect(await usage.flush()).toBe(2);
    expect(rows.map((row) => [row.item, row.count])).toEqual([
      ['', 3],
      ['library.book.list', 1],
    ]);
    expect(rows[0]).toEqual({
      day: '2026-11-12',
      backendId,
      tenantId,
      apiVersion: '2026-11-04',
      transport: 'rest',
      item: '',
      count: 3,
    });
  });

  test('records nothing for a dry run, a job carrier or an invoker without apiUsage', async () => {
    const { adapter } = fakeControl();
    const usage = usageOf(adapter);
    await countApiUsage(envOf(usage), runOf({ dry: true }));
    await countApiUsage(envOf(usage), runOf({ job: true }));
    await countApiUsage(envOf(undefined), runOf({}));
    expect(await usage.flush()).toBe(0);
  });

  test('a deployment scope counts under the deployment id, a backend scope under its backend', async () => {
    const { adapter, rows } = fakeControl();
    const usage = usageOf(adapter);
    await countApiUsage(envOf(usage), runOf({ scope: { level: 'deployment' } }));
    await countApiUsage(envOf(usage), runOf({ scope: { level: 'backend', backendId } }));
    await usage.flush();
    expect(rows.map((row) => [row.backendId, row.tenantId])).toEqual([
      [backendId, backendId],
      [deploymentId, deploymentId],
    ]);
  });

  test('never throws', async () => {
    const env = {
      options: {
        clock: { now: () => now },
        log: { warn: () => undefined },
        apiUsage: {
          record: () => {
            throw new Error('broken');
          },
        },
      },
    } as unknown as InvokerEnv;
    await expect(countApiUsage(env, runOf({}))).resolves.toBeUndefined();
  });
});
