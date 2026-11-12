import type { ApiUsageCount } from '@keelwerk/core';
import { apiUsageCases } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { storeHarness } from './support/store-harness.ts';
import { deploymentScope, id } from './support/store-rows.ts';

const { run, read } = storeHarness('stores_api_usage');

function count(n: number, over: Partial<ApiUsageCount> = {}): ApiUsageCount {
  return {
    day: '2026-11-12',
    backendId: id(n),
    tenantId: id(n),
    apiVersion: '2026-11-04',
    transport: 'rest',
    item: '',
    count: 1,
    ...over,
  };
}

const totalsOf = () =>
  run(deploymentScope, async (u) =>
    u.apiUsage?.totals({ since: '2026-11-12', until: '2026-11-12', limit: 500 }),
  );

// The same cases as the conformance suite and the PGlite test, on the real control root.
apiUsageCases({ run, read }, { table: true });

describe('kw_api_usage on PostgreSQL 18 (S-144)', () => {
  test('two concurrent flushes of the same keys add up on PostgreSQL 18', async () => {
    const rows = Array.from({ length: 20 }, (_, n) => count(n + 1, { count: 3 }));
    const flush = () => run(deploymentScope, async (u) => u.apiUsage?.add(rows));
    await Promise.all([flush(), flush(), flush(), flush()]);
    const totals = await totalsOf();
    expect(totals?.length).toBe(20);
    expect(totals?.every((total) => total.count === 12)).toBe(true);
  });

  test('two flushes over overlapping keys in opposite input orders finish without a deadlock', async () => {
    const forward = Array.from({ length: 200 }, (_, n) => count(n + 1));
    const backward = [...forward].reverse();
    const flush = (rows: readonly ApiUsageCount[]) =>
      run(deploymentScope, async (u) => u.apiUsage?.add(rows));
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([flush(forward), flush(backward), flush(forward), flush(backward)]);
    }
    const totals = await totalsOf();
    expect(totals?.length).toBe(200);
    expect(totals?.every((total) => total.count === 20)).toBe(true);
  });
});
