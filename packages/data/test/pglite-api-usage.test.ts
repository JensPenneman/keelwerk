import type { ApiUsageCount } from '@keelwerk/core';
import { apiUsageCases } from '@keelwerk/testing';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { storeControlNamespace } from './support/store-control-namespace.ts';

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await openClockedPglite();
  await adapter.schema.provision(storeControlNamespace, []);
}, 120_000);

beforeEach(async () => {
  await adapter.asOwner(async (database) =>
    database.exec(`truncate "${storeControlNamespace.root}".kw_api_usage`),
  );
});

afterAll(async () => {
  await adapter.close(1000);
}, 60_000);

// The same cases as the conformance suite and the PostgreSQL test, on the real control root.
apiUsageCases(
  {
    run: (scope, fn) => adapter.unit(storeControlNamespace, scope, fn),
    read: (scope, fn) => adapter.unit(storeControlNamespace, scope, fn, { readOnly: true }),
  },
  { table: true },
);

const count: ApiUsageCount = {
  day: '2026-11-11',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId: '00000000-0000-4000-8000-0000000000b1',
  apiVersion: '2026-11-04',
  transport: 'rest',
  item: '',
  count: 1,
};

test('the first and last day are ISO dates whatever DateStyle the session has', async () => {
  // A managed database often sets `datestyle = 'German, DMY'`, which prints a date as 11.11.2026.
  await adapter.asOwner(async (database) => database.exec(`set datestyle = 'German, DMY'`));
  try {
    await adapter.unit(storeControlNamespace, deploymentScope, async (unit) =>
      unit.apiUsage?.add([count, { ...count, day: '2026-11-12' }]),
    );
    const totals = await adapter.unit(
      storeControlNamespace,
      deploymentScope,
      async (unit) =>
        unit.apiUsage?.totals({ since: '2026-11-01', until: '2026-11-30', limit: 10 }),
      { readOnly: true },
    );
    expect(totals?.map((total) => [total.firstDay, total.lastDay])).toEqual([
      ['2026-11-11', '2026-11-12'],
    ]);
  } finally {
    await adapter.asOwner(async (database) => database.exec('reset datestyle'));
  }
});
