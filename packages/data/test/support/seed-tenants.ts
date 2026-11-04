import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { backend } from './backend.ts';
import { backendScope } from './backend-scope.ts';
import { enqueueJob } from './enqueue-job-seed.ts';
import { inUnit } from './in-unit.ts';
import { insertFor } from './insert-for.ts';
import { laneCounts } from './lane-counts-seed.ts';
import { ns } from './ns.ts';
import { runStatement } from './run-statement.ts';
import { seeds } from './seeds.ts';
import { storageTenant } from './storage-tenant.ts';
import { tenantA } from './tenant-a.ts';
import { tenantB } from './tenant-b.ts';

/** Seeds both tenants and the backend with a row in every scoped table; resolves to the lane of tenant A. */
export async function seedTenants(adapter: PgliteAdapter): Promise<string> {
  for (const id of [tenantA, tenantB]) {
    await inUnit(adapter, storageTenant(id), async (u) => {
      for (const [, statement] of seeds) await runStatement(u, statement, [id]);
      await runStatement(u, laneCounts, [id]);
      await runStatement(u, enqueueJob, [id]);
    });
  }
  await inUnit(adapter, backendScope, async (u) => {
    await runStatement(u, insertFor('kw_usage', backend, '').text, [backend]);
  });
  const lanes = await inUnit(adapter, storageTenant(tenantA), async (u) =>
    runStatement(u, `select id::text as id from ${ns}.kw_job_lanes`),
  );
  return String(lanes.rows[0]?.id);
}
